// Quais instaladores de Mac a landing oferece, a partir dos assets da release. `craco test`.
import { pickMac } from './DesktopDownloadButtons';

const url = (name: string) => `https://example.test/${name}`;
const asset = (name: string) => ({ name, browser_download_url: url(name) });

describe('pickMac', () => {
  it('um dmg por arquitetura: oferece os dois, Apple Silicon primeiro', () => {
    // Nomes como o forge publica (maker-dmg / maker-zip / Squirrel).
    const assets = [
      'Film.Assistant-1.3.8-x64.dmg',
      'Film.Assistant-darwin-x64-1.3.8.zip',
      'Film.Assistant-1.3.8-arm64.dmg',
      'Film.Assistant-darwin-arm64-1.3.8.zip',
      'FilmAssistantSetup.exe',
      'film_assistant-1.3.8-full.nupkg',
      'RELEASES',
    ].map(asset);
    expect(pickMac(assets)).toEqual([
      { arch: 'arm64', url: url('Film.Assistant-1.3.8-arm64.dmg') },
      { arch: 'x64', url: url('Film.Assistant-1.3.8-x64.dmg') },
    ]);
  });

  it('release só com arm64 (até a 1.3.7): um botão, identificado como Apple Silicon', () => {
    const assets = ['Film.Assistant-1.3.7-arm64.dmg', 'Film.Assistant-darwin-arm64-1.3.7.zip'].map(asset);
    expect(pickMac(assets)).toEqual([{ arch: 'arm64', url: url('Film.Assistant-1.3.7-arm64.dmg') }]);
  });

  it('dmg universal vence os por arquitetura', () => {
    const assets = ['App-1.0.0-arm64.dmg', 'App-1.0.0-universal.dmg', 'App-1.0.0-x64.dmg'].map(asset);
    expect(pickMac(assets)).toEqual([{ arch: 'any', url: url('App-1.0.0-universal.dmg') }]);
  });

  it('dmg sem arquitetura no nome vira o botão genérico', () => {
    expect(pickMac([asset('Film.Assistant.dmg')])).toEqual([{ arch: 'any', url: url('Film.Assistant.dmg') }]);
  });

  it('sem dmg não há botão de Mac — o .zip do auto-update não conta', () => {
    expect(pickMac(['Film.Assistant-darwin-arm64-1.3.8.zip', 'FilmAssistantSetup.exe'].map(asset))).toEqual([]);
  });
});
