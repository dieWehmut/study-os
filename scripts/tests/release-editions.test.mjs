import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

// Normalize CRLF so a Windows checkout reads the same as the LF checkout CI
// uses. Slicing on a literal newline without this silently misses on Windows
// and yields an empty result, which hides the very contract under test.
function read(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8").replace(/\r\n/g, "\n")
}

test("the release matrix ships exactly the two Windows desktop editions", () => {
  const workflow = read(".github/workflows/release.yml")

  // One build job, parameterized by architecture: a second build job would mean
  // a second product, which is exactly what the PWA package used to be.
  const jobs = workflow.slice(workflow.indexOf("\njobs:\n"))
  const buildJobs = [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):$/gm)].map((match) => match[1])
  assert.deepEqual(buildJobs, ["build-windows", "publish"])

  assert.match(workflow, /arch: x64\s*\n\s*goarch: amd64/)
  assert.match(workflow, /arch: arm64\s*\n\s*goarch: arm64/)
  assert.match(workflow, /needs: \[build-windows\]/)

  // The retired PWA job and its archive must not come back.
  assert.doesNotMatch(workflow, /build-pwa/)
  assert.doesNotMatch(workflow, /study-os-pwa/)
  assert.doesNotMatch(workflow, /study-os-server/)
})

test("only the desktop packaging script feeds the release", () => {
  const scripts = fs.readdirSync(path.join(repositoryRoot, "scripts"))
  assert.ok(scripts.includes("package-release.ps1"))
  for (const retired of ["package-pwa-release.ps1", "install-pwa.ps1"]) {
    assert.ok(!scripts.includes(retired), `retired PWA script is still present: ${retired}`)
  }

  const packaging = read("scripts/package-release.ps1")
  assert.match(packaging, /ValidateSet\('x64', 'arm64'\)/)
  assert.match(packaging, /entrypoint = 'StudyOS\.exe'/)
  assert.match(packaging, /study-os-\$Version-windows-\$architecture\.zip/)
})

test("the installer only resolves the two supported architectures", () => {
  const installer = read("install.ps1")
  const switchBlock = installer.slice(installer.indexOf("switch ($Architecture.ToUpperInvariant())"))
  const cases = [...switchBlock.slice(0, switchBlock.indexOf("default:")).matchAll(/'(\w+)' \{ return '([\w]+)' \}/g)]
    .map((match) => [match[1], match[2]])

  assert.deepEqual(cases, [["AMD64", "x64"], ["X64", "x64"], ["ARM64", "arm64"]])
  // A 32-bit build is deliberately out of scope: "x86 Windows" in this
  // repository means the Intel/AMD 64-bit edition, not windows/386.
  assert.doesNotMatch(installer, /windows\/386|'386'|i386/)
})

test("the readme and manifest describe only the two desktop editions", () => {
  const readme = read("README.md")
  assert.match(readme, /x64/)
  assert.match(readme, /arm64/)
  assert.doesNotMatch(readme, /PWA/)
  assert.doesNotMatch(readme, /install-pwa/)

  const workflow = read(".github/workflows/release.yml")
  assert.match(workflow, /windows\/\$\{\{ matrix\.goarch \}\}/)

  // The published manifest schema still names the desktop entrypoint, so an
  // installer or updater reading it is looking for the desktop app.
  const example = JSON.parse(read("release/manifest.example.json"))
  const archived = Array.isArray(example) ? example : example.assets
  assert.ok(archived.length > 0, "manifest example declares no assets")
  for (const asset of archived) {
    assert.equal(asset.os, "windows")
    assert.ok(["x64", "arm64"].includes(asset.arch), `unexpected architecture: ${asset.arch}`)
    assert.equal(asset.entrypoint, "StudyOS.exe")
  }
})
