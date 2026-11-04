import CryptoKit
import ExpoModulesCore
import Foundation
import NIOCore
import NIOPosix
import NIOSSH
import Security

// SSH for the iPhone app: the same job the Mac does with the `ssh` binary.
//  - an Ed25519 key made on the phone and kept in the Keychain (only its public half leaves);
//  - one connection to the Hermes host, with its host key pinned on first use;
//  - exec with the script on stdin, so nothing secret lands in the remote argv;
//  - local port forwards (127.0.0.1:<random> → host 127.0.0.1:<port>) for HTTP and the WebSocket.
// Exec, glue and forwarding follow swift-nio-ssh's NIOSSHClient example (Apache-2.0).

public class KitabSshModule: Module {
  private let ssh = SSHManager()

  public func definition() -> ModuleDefinition {
    Name("KitabSsh")

    /// "ssh-ed25519 AAAA… kitab-iphone", making the key on first use.
    AsyncFunction("publicKey") { () -> String in
      try KeyStore.publicKeyLine()
    }

    AsyncFunction("resetKey") { () in
      KeyStore.delete()
      await self.ssh.disconnect()
    }

    /// Connects (or keeps a live connection to the same target). Resolves to the host key it saw.
    AsyncFunction("connect") { (host: String, port: Int, user: String, pinnedHostKey: String?) -> [String: String] in
      try await self.ssh.connect(host: host, port: port, user: user, pinned: pinnedHostKey)
    }

    AsyncFunction("exec") { (script: String, timeoutMs: Int) -> [String: Any] in
      let r = try await self.ssh.exec(script: script, timeoutMs: timeoutMs)
      return ["stdout": r.stdout, "stderr": r.stderr, "code": r.code]
    }

    /// Local port on 127.0.0.1 that forwards to 127.0.0.1:remotePort on the host.
    AsyncFunction("forward") { (remotePort: Int) -> Int in
      try await self.ssh.forward(remotePort: remotePort)
    }

    AsyncFunction("isConnected") { () -> Bool in
      await self.ssh.isConnected
    }

    AsyncFunction("disconnect") { () in
      await self.ssh.disconnect()
    }
  }
}

// MARK: - Errors

struct SSHFailure: LocalizedError {
  let code: String
  let message: String
  var errorDescription: String? { message }
}

// MARK: - Key

enum KeyStore {
  private static let service = "app.kitab.ssh"
  private static let account = "ed25519"

  static func load() -> Curve25519.Signing.PrivateKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return try? Curve25519.Signing.PrivateKey(rawRepresentation: data)
  }

  static func loadOrCreate() throws -> Curve25519.Signing.PrivateKey {
    if let key = load() { return key }
    let key = Curve25519.Signing.PrivateKey()
    let add: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecValueData as String: key.rawRepresentation,
      // Never synced or restored to another device.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemAdd(add as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw SSHFailure(code: "KEYCHAIN", message: "Couldn't save the SSH key in the Keychain (\(status))")
    }
    return key
  }

  static func delete() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }

  static func publicKeyLine() throws -> String {
    let key = NIOSSHPrivateKey(ed25519Key: try loadOrCreate())
    return String(openSSHPublicKey: key.publicKey) + " kitab-iphone"
  }
}

/// "SHA256:…" like `ssh-keygen -l`, from an OpenSSH public key line.
func fingerprint(_ openSSH: String) -> String {
  let parts = openSSH.split(separator: " ")
  guard parts.count >= 2, let blob = Data(base64Encoded: String(parts[1])) else { return openSSH }
  let digest = Data(SHA256.hash(data: blob)).base64EncodedString()
  return "SHA256:" + digest.replacingOccurrences(of: "=", with: "")
}

// MARK: - Delegates

final class KeyAuthDelegate: NIOSSHClientUserAuthenticationDelegate {
  private let user: String
  private let key: NIOSSHPrivateKey
  private var offered = false

  init(user: String, key: NIOSSHPrivateKey) {
    self.user = user
    self.key = key
  }

  func nextAuthenticationType(
    availableMethods: NIOSSHAvailableUserAuthenticationMethods,
    nextChallengePromise: EventLoopPromise<NIOSSHUserAuthenticationOffer?>
  ) {
    guard !offered, availableMethods.contains(.publicKey) else {
      nextChallengePromise.fail(SSHFailure(code: "AUTH", message: "The server didn't accept this iPhone's SSH key. Add it to ~/.ssh/authorized_keys on the host."))
      return
    }
    offered = true
    nextChallengePromise.succeed(.init(username: user, serviceName: "", offer: .privateKey(.init(privateKey: key))))
  }
}

final class PinnedHostKeyDelegate: NIOSSHClientServerAuthenticationDelegate {
  private let pinned: String?
  private(set) var seen: String?

  init(pinned: String?) {
    self.pinned = pinned
  }

  func validateHostKey(hostKey: NIOSSHPublicKey, validationCompletePromise: EventLoopPromise<Void>) {
    let line = String(openSSHPublicKey: hostKey)
    seen = line
    if let pinned, pinned != line {
      validationCompletePromise.fail(SSHFailure(
        code: "HOST_KEY_CHANGED",
        message: "The host's SSH key changed (now \(fingerprint(line))). If you expected this, forget the host in Settings and connect again."))
    } else {
      validationCompletePromise.succeed(())
    }
  }
}

/// Completes once user auth succeeds; fails if the connection dies first.
final class AuthWatcher: ChannelInboundHandler {
  typealias InboundIn = Any
  private var promise: EventLoopPromise<Void>?
  private var lastError: Error?

  init(promise: EventLoopPromise<Void>) {
    self.promise = promise
  }

  func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
    if event is UserAuthSuccessEvent {
      promise?.succeed(())
      promise = nil
    }
    context.fireUserInboundEventTriggered(event)
  }

  func errorCaught(context: ChannelHandlerContext, error: Error) {
    lastError = error
    context.close(promise: nil)
  }

  func channelInactive(context: ChannelHandlerContext) {
    promise?.fail(lastError ?? SSHFailure(code: "CLOSED", message: "The SSH connection closed during sign-in"))
    promise = nil
    context.fireChannelInactive()
  }
}

// MARK: - Exec

struct ExecResult {
  var stdout = ""
  var stderr = ""
  var code = -1
}

/// Runs one command, writes `stdin` then EOF, and collects the output until the channel closes.
final class ScriptExecHandler: ChannelDuplexHandler {
  typealias InboundIn = SSHChannelData
  typealias OutboundIn = ByteBuffer
  typealias OutboundOut = SSHChannelData

  private let command: String
  private let stdin: String
  private var promise: EventLoopPromise<ExecResult>?
  private var result = ExecResult()
  private var out = ByteBuffer()
  private var err = ByteBuffer()

  init(command: String, stdin: String, promise: EventLoopPromise<ExecResult>) {
    self.command = command
    self.stdin = stdin
    self.promise = promise
  }

  func handlerAdded(context: ChannelHandlerContext) {
    context.channel.setOption(ChannelOptions.allowRemoteHalfClosure, value: true).whenFailure { error in
      context.fireErrorCaught(error)
    }
  }

  func channelActive(context: ChannelHandlerContext) {
    let exec = SSHChannelRequestEvent.ExecRequest(command: command, wantReply: true)
    context.triggerUserOutboundEvent(exec).whenFailure { error in
      context.fireErrorCaught(error)
    }
    var buffer = context.channel.allocator.buffer(capacity: stdin.utf8.count)
    buffer.writeString(stdin)
    context.writeAndFlush(wrapOutboundOut(SSHChannelData(type: .channel, data: .byteBuffer(buffer))), promise: nil)
    context.close(mode: .output, promise: nil)
    context.fireChannelActive()
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    let data = unwrapInboundIn(data)
    guard case .byteBuffer(var bytes) = data.data else { return }
    switch data.type {
    case .channel: out.writeBuffer(&bytes)
    case .stdErr: err.writeBuffer(&bytes)
    default: break
    }
  }

  func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
    if let status = event as? SSHChannelRequestEvent.ExitStatus {
      result.code = status.exitStatus
    } else if let event = event as? ChannelEvent, case .inputClosed = event {
      // The remote end is done writing; the channel closes once it also exits.
    } else {
      context.fireUserInboundEventTriggered(event)
    }
  }

  func errorCaught(context: ChannelHandlerContext, error: Error) {
    promise?.fail(error)
    promise = nil
    context.close(promise: nil)
  }

  func channelInactive(context: ChannelHandlerContext) {
    finish()
    context.fireChannelInactive()
  }

  func handlerRemoved(context: ChannelHandlerContext) {
    finish()
  }

  private func finish() {
    guard let promise else { return }
    self.promise = nil
    result.stdout = out.readString(length: out.readableBytes) ?? ""
    result.stderr = err.readString(length: err.readableBytes) ?? ""
    promise.succeed(result)
  }
}

// MARK: - Forwarding

/// Wraps bytes in SSH channel data and back.
final class SSHWrapperHandler: ChannelDuplexHandler {
  typealias InboundIn = SSHChannelData
  typealias InboundOut = ByteBuffer
  typealias OutboundIn = ByteBuffer
  typealias OutboundOut = SSHChannelData

  func channelRead(context: ChannelHandlerContext, data: NIOAny) {
    let data = unwrapInboundIn(data)
    guard case .channel = data.type, case .byteBuffer(let buffer) = data.data else { return }
    context.fireChannelRead(wrapInboundOut(buffer))
  }

  func write(context: ChannelHandlerContext, data: NIOAny, promise: EventLoopPromise<Void>?) {
    let buffer = unwrapOutboundIn(data)
    context.write(wrapOutboundOut(SSHChannelData(type: .channel, data: .byteBuffer(buffer))), promise: promise)
  }
}

/// Joins two channels on the same event loop, with backpressure and half-close.
final class GlueHandler: ChannelDuplexHandler {
  typealias InboundIn = NIOAny
  typealias OutboundIn = NIOAny
  typealias OutboundOut = NIOAny

  private var partner: GlueHandler?
  private var context: ChannelHandlerContext?
  private var pendingRead = false

  static func matchedPair() -> (GlueHandler, GlueHandler) {
    let a = GlueHandler()
    let b = GlueHandler()
    a.partner = b
    b.partner = a
    return (a, b)
  }

  private func partnerWrite(_ data: NIOAny) { context?.write(data, promise: nil) }
  private func partnerFlush() { context?.flush() }
  private func partnerWriteEOF() { context?.close(mode: .output, promise: nil) }
  private func partnerCloseFull() { context?.close(promise: nil) }
  private func partnerBecameWritable() {
    if pendingRead {
      pendingRead = false
      context?.read()
    }
  }
  private var partnerWritable: Bool { context?.channel.isWritable ?? false }

  func handlerAdded(context: ChannelHandlerContext) {
    self.context = context
    if context.channel.isWritable { partner?.partnerBecameWritable() }
  }

  func handlerRemoved(context: ChannelHandlerContext) {
    self.context = nil
    partner = nil
  }

  func channelRead(context: ChannelHandlerContext, data: NIOAny) { partner?.partnerWrite(data) }
  func channelReadComplete(context: ChannelHandlerContext) { partner?.partnerFlush() }
  func channelInactive(context: ChannelHandlerContext) { partner?.partnerCloseFull() }

  func userInboundEventTriggered(context: ChannelHandlerContext, event: Any) {
    if let event = event as? ChannelEvent, case .inputClosed = event { partner?.partnerWriteEOF() }
  }

  func errorCaught(context: ChannelHandlerContext, error: Error) { partner?.partnerCloseFull() }

  func channelWritabilityChanged(context: ChannelHandlerContext) {
    if context.channel.isWritable { partner?.partnerBecameWritable() }
  }

  func read(context: ChannelHandlerContext) {
    if let partner, partner.partnerWritable { context.read() } else { pendingRead = true }
  }
}

final class CloseOnError: ChannelInboundHandler {
  typealias InboundIn = Any
  func errorCaught(context: ChannelHandlerContext, error: Error) { context.close(promise: nil) }
}

// MARK: - Manager

actor SSHManager {
  // One thread: the SSH connection, its child channels and the local listeners all share
  // one event loop, which GlueHandler and NIOSSHHandler both need.
  private let group = MultiThreadedEventLoopGroup(numberOfThreads: 1)
  private var channel: Channel?
  private var target: String?
  private var hostKey: String?
  private var listeners: [Int: (channel: Channel, port: Int)] = [:]

  var isConnected: Bool { channel?.isActive ?? false }

  func connect(host: String, port: Int, user: String, pinned: String?) async throws -> [String: String] {
    let key = "\(user)@\(host):\(port)"
    if let channel, channel.isActive, target == key, let hostKey {
      return ["hostKey": hostKey, "fingerprint": fingerprint(hostKey)]
    }
    await disconnect()

    let privateKey = NIOSSHPrivateKey(ed25519Key: try KeyStore.loadOrCreate())
    let hostKeys = PinnedHostKeyDelegate(pinned: pinned)
    let loop = group.next()
    let authed = loop.makePromise(of: Void.self)

    let bootstrap = ClientBootstrap(group: loop)
      .connectTimeout(.seconds(10))
      .channelOption(ChannelOptions.socket(SocketOptionLevel(SOL_SOCKET), SO_KEEPALIVE), value: 1)
      .channelOption(ChannelOptions.socket(SocketOptionLevel(IPPROTO_TCP), TCP_NODELAY), value: 1)
      .channelInitializer { channel in
        channel.eventLoop.makeCompletedFuture {
          let handler = NIOSSHHandler(
            role: .client(.init(userAuthDelegate: KeyAuthDelegate(user: user, key: privateKey), serverAuthDelegate: hostKeys)),
            allocator: channel.allocator,
            inboundChildChannelInitializer: nil)
          try channel.pipeline.syncOperations.addHandler(handler)
          try channel.pipeline.syncOperations.addHandler(AuthWatcher(promise: authed))
        }
      }

    let channel: Channel
    do {
      channel = try await bootstrap.connect(host: host, port: port).get()
    } catch {
      authed.fail(error)
      throw SSHFailure(code: "CONNECT", message: "Couldn't reach \(host):\(port): \(error.localizedDescription)")
    }
    do {
      try await withTimeout(seconds: 20, on: loop) { authed.futureResult }
    } catch {
      channel.close(promise: nil)
      throw error
    }

    self.channel = channel
    self.target = key
    self.hostKey = hostKeys.seen
    let seen = hostKeys.seen ?? ""
    return ["hostKey": seen, "fingerprint": fingerprint(seen)]
  }

  func exec(script: String, timeoutMs: Int) async throws -> ExecResult {
    let channel = try live()
    let done = channel.eventLoop.makePromise(of: ExecResult.self)
    let opened = channel.eventLoop.makePromise(of: Channel.self)
    channel.eventLoop.execute {
      do {
        let ssh = try channel.pipeline.syncOperations.handler(type: NIOSSHHandler.self)
        ssh.createChannel(opened, channelType: .session) { child, type in
          guard type == .session else {
            return child.eventLoop.makeFailedFuture(SSHFailure(code: "CHANNEL", message: "Unexpected SSH channel type"))
          }
          return child.eventLoop.makeCompletedFuture {
            try child.pipeline.syncOperations.addHandler(ScriptExecHandler(command: "sh -s", stdin: script, promise: done))
          }
        }
      } catch {
        opened.fail(error)
      }
    }
    opened.futureResult.whenFailure { done.fail($0) }
    let child = try await opened.futureResult.get()
    do {
      return try await withTimeout(seconds: Double(timeoutMs) / 1000, on: channel.eventLoop) { done.futureResult }
    } catch {
      child.close(promise: nil)
      throw error
    }
  }

  func forward(remotePort: Int) async throws -> Int {
    let channel = try live()
    if let existing = listeners[remotePort], existing.channel.isActive { return existing.port }

    let server = try await ServerBootstrap(group: channel.eventLoop, childGroup: channel.eventLoop)
      .serverChannelOption(ChannelOptions.socketOption(.so_reuseaddr), value: 1)
      .childChannelOption(ChannelOptions.socket(SocketOptionLevel(IPPROTO_TCP), TCP_NODELAY), value: 1)
      .childChannelInitializer { inbound in
        let opened = inbound.eventLoop.makePromise(of: Channel.self)
        do {
          let ssh = try channel.pipeline.syncOperations.handler(type: NIOSSHHandler.self)
          let origin = inbound.remoteAddress ?? (try! SocketAddress(ipAddress: "127.0.0.1", port: 0))
          ssh.createChannel(
            opened,
            channelType: .directTCPIP(.init(targetHost: "127.0.0.1", targetPort: remotePort, originatorAddress: origin))
          ) { child, _ in
            child.eventLoop.makeCompletedFuture {
              let (ours, theirs) = GlueHandler.matchedPair()
              try child.pipeline.syncOperations.addHandlers([SSHWrapperHandler(), ours, CloseOnError()])
              try inbound.pipeline.syncOperations.addHandlers([theirs, CloseOnError()])
            }
          }
        } catch {
          opened.fail(error)
        }
        return opened.futureResult.map { _ in }
      }
      .bind(host: "127.0.0.1", port: 0)
      .get()

    guard let port = server.localAddress?.port else {
      server.close(promise: nil)
      throw SSHFailure(code: "FORWARD", message: "Couldn't open a local port")
    }
    listeners[remotePort] = (server, port)
    return port
  }

  func disconnect() async {
    for (_, l) in listeners { l.channel.close(promise: nil) }
    listeners.removeAll()
    channel?.close(promise: nil)
    channel = nil
    target = nil
    hostKey = nil
  }

  private func live() throws -> Channel {
    guard let channel, channel.isActive else {
      throw SSHFailure(code: "NOT_CONNECTED", message: "Not connected to the SSH host")
    }
    return channel
  }
}

/// Awaits a future, failing after `seconds`.
func withTimeout<T>(seconds: Double, on loop: EventLoop, _ body: () -> EventLoopFuture<T>) async throws -> T {
  let promise = loop.makePromise(of: T.self)
  let timer = loop.scheduleTask(in: .milliseconds(Int64(seconds * 1000))) {
    promise.fail(SSHFailure(code: "TIMEOUT", message: "The SSH host took too long to answer"))
  }
  body().cascade(to: promise)
  defer { timer.cancel() }
  return try await promise.futureResult.get()
}
