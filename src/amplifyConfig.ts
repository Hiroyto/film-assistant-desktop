// amplifyConfig.ts — ponto único de import da configuração do Amplify, espelhando
// o my-app (web): lá este módulo monta o bloco `oauth` do login com Google a
// partir das variáveis REACT_APP_COGNITO_OAUTH_* por cima de um aws-exports.js
// gerado pelo Amplify CLI (que fica fora do git na web).
//
// DIVERGE DE PROPÓSITO da versão web: no desktop o próprio src/aws-exports.js já
// monta esse bloco — com o redirect filmassistant://auth/callback do Electron além
// da origem web — então aqui é só um repasse. Sobrescrever com a versão web
// trocaria o bloco pelo web-only e quebraria o "Continue with Google" do desktop.
// Os arquivos compartilhados com a web (App, header, footer, home, scenes,
// community, events) importam daqui para continuarem verbatim entre os repos.
import config from './aws-exports';

export default config;
