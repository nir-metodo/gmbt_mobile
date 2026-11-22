Pod::Spec.new do |s|
  s.name           = 'CallUi'
  s.version        = '0.1.0'
  s.summary        = 'Native incoming call screen (PushKit VoIP + CallKit) for Gambot'
  s.description    = 'Wakes the app with a VoIP push and shows the system call screen (CallKit).'
  s.author         = 'Gambot'
  s.homepage       = 'https://gambot.co.il'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PushKit', 'CallKit', 'AVFoundation'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
