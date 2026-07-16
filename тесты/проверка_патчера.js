'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const PATCHER_PATH = path.resolve(__dirname, '..', 'bin', 'patcher.js')

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
}

function makeRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'проверка-патчера-hermes-ru-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function loadPatcher({ homeDir, hermesHome, tempDir, execSyncImpl } = {}) {
  const source = fs.readFileSync(PATCHER_PATH, 'utf8') + `
module.exports.__test = {
  createShortcut,
  findHermesResources,
  getPersistentDataDir,
  setConfigLanguage
}
`
  const fakeOs = {
    ...os,
    homedir: () => homeDir,
    tmpdir: () => tempDir
  }
  const moduleObject = { exports: {} }
  const fakeProcess = {
    env: { ...process.env, HERMES_HOME: hermesHome },
    execPath: process.execPath,
    exit(code) { throw new Error(`Неожиданный process.exit(${code})`) }
  }
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    module: moduleObject,
    exports: moduleObject.exports,
    __dirname: path.dirname(PATCHER_PATH),
    process: fakeProcess,
    require(id) {
      if (id === 'os') return fakeOs
      if (id === 'child_process') return { execSync: execSyncImpl || (() => undefined) }
      if (id === '../package.json') return require(path.resolve(path.dirname(PATCHER_PATH), '..', 'package.json'))
      return require(id)
    }
  }
  vm.runInNewContext(source, sandbox, { filename: PATCHER_PATH })
  return moduleObject.exports.__test
}

test('патчер находит Hermes через активный HERMES_HOME', t => {
  const root = makeRoot(t)
  const homeDir = path.join(root, 'дом')
  const hermesHome = path.join(root, 'активный-hermes')
  const resources = path.join(hermesHome, 'hermes-agent', 'apps', 'desktop', 'release', 'win-unpacked', 'resources')
  write(path.join(resources, 'app.asar'), 'fixture')

  const patcher = loadPatcher({ homeDir, hermesHome, tempDir: path.join(root, 'временные') })
  assert.equal(path.resolve(patcher.findHermesResources()), path.resolve(resources))
})

test('патчер меняет display.language только в активном HERMES_HOME', t => {
  const root = makeRoot(t)
  const homeDir = path.join(root, 'дом')
  const hermesHome = path.join(root, 'активный-hermes')
  const activeConfig = path.join(hermesHome, 'config.yaml')
  const legacyConfig = path.join(homeDir, '.hermes', 'config.yaml')
  write(activeConfig, 'voice:\n  language: ru-RU\ndisplay:\n  language: en\n')
  write(legacyConfig, 'display:\n  language: en\n')

  const patcher = loadPatcher({ homeDir, hermesHome, tempDir: path.join(root, 'временные') })
  patcher.setConfigLanguage()

  assert.match(fs.readFileSync(activeConfig, 'utf8'), /voice:\n  language: ru-RU\ndisplay:\n  language: ru/)
  assert.match(fs.readFileSync(legacyConfig, 'utf8'), /language: en/)
})

test('Ярлык создаётся через инлайн-PowerShell без временного файла', t => {
  const root = makeRoot(t)
  const homeDir = path.join(root, 'дом')
  const hermesHome = path.join(root, 'активный-hermes')
  const tempDir = path.join(root, 'временные')
  fs.mkdirSync(tempDir, { recursive: true })
  const lnkPath = path.join(homeDir, 'Desktop', 'Hermes RU.lnk')
  const launcherPath = path.join(homeDir, '.hermes', 'russian-loc', 'hermes-ru-launcher.js')
  let capturedCommand = ''

  const patcher = loadPatcher({
    homeDir,
    hermesHome,
    tempDir,
    execSyncImpl(command) {
      capturedCommand = String(command)
    }
  })
  assert.equal(patcher.createShortcut(lnkPath, launcherPath), true)

  // Инлайн-PowerShell: -Command (не -File), без временного скрипта
  assert.match(capturedCommand, /powershell.*-Command/)
  assert.doesNotMatch(capturedCommand, /-File/)
  // Содержит создание ярлыка через WScript.Shell
  assert.match(capturedCommand, /WScript\.Shell/)
  assert.match(capturedCommand, /\.Save\(\)/)
  // launcherPath присутствует внутри Arguments (экранирован в двойных кавычках)
  assert.match(capturedCommand, /Arguments='/)
})
