Pod::Spec.new do |s|
  s.name           = 'KitabSsh'
  s.version        = '1.0.0'
  s.summary        = 'SSH exec and port forwarding for Kitab'
  s.description    = 'Keychain-held Ed25519 key, pinned host key, exec with stdin, and local port forwards over swift-nio-ssh.'
  s.author         = ''
  s.homepage       = 'https://github.com/plusminushalf/kitaab'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  # Swift packages, linked into this pod by React Native's SPM support.
  spm_dependency(s,
    url: 'https://github.com/apple/swift-nio-ssh.git',
    requirement: { kind: 'upToNextMinorVersion', minimumVersion: '0.15.1' },
    products: ['NIOSSH'])
  spm_dependency(s,
    url: 'https://github.com/apple/swift-nio.git',
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '2.81.0' },
    products: ['NIOCore', 'NIOPosix'])

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
