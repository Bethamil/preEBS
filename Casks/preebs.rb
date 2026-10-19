cask "preebs" do
  version "2.0.0"

  name "PreEBS"
  desc "Monday–Friday hours, exported for the EBS browser extensions"
  homepage "https://github.com/Bethamil/preEBS"

  on_arm do
    sha256 "07e7b5ddd3cf5489cec25ff0e5d4309aac3daed311b857780cf66cef6d4da589"
    url "https://github.com/Bethamil/preEBS/releases/download/v#{version}/PreEBS_#{version}_aarch64.dmg"
  end
  on_intel do
    sha256 "a62f25c727b7050156e63b19f32218a80d8c51745ce3af7cfb5da6f6a40e4d62"
    url "https://github.com/Bethamil/preEBS/releases/download/v#{version}/PreEBS_#{version}_x64.dmg"
  end

  depends_on macos: ">= :big_sur"

  app "PreEBS.app"
  binary "#{appdir}/PreEBS.app/Contents/MacOS/preebs-cli", target: "preebs"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/PreEBS.app"]
  end

  zap trash: [
    "~/Library/Application Support/PreEBS",
  ]
end
