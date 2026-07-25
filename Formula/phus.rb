class Phus < Formula
  desc "Self-evolving agent runtime — every turn repeats, every turn grows"
  homepage "https://github.com/narcilee7/phus"
  license "MIT"

  depends_on "node"

  # Homebrew archive is currently built for macOS only. Linux asset is
  # produced by CI and will be added here once available.
  if OS.mac?
    url "https://github.com/narcilee7/phus/releases/download/v0.1.4/phus-homebrew-0.1.4-darwin.tar.gz"
    sha256 "c8708237926cab9f1cefed74912c7f74824efc9df99ae18bb62bda66264ef059"
  else
    odie "Linux Homebrew archive is not yet available. Use npm or build from source."
  end

  def install
    libexec.install Dir["*"]
    bin.install_symlink libexec/"dist/phus.mjs" => "phus"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/phus --version")
  end
end
