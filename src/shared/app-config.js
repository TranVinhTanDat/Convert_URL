export const appConfig = {
    appName: 'Convert URL Studio',
    host: '127.0.0.1',
    webPort: 5173,
    apiPort: 5175,
    apiRoutes: ['/api', '/downloads'],
    paths: {
        clientDist: 'dist/client',
        downloads: 'downloads'
    }
};
export function getWebOrigin() {
    return `http://${appConfig.host}:${appConfig.webPort}`;
}
export function getApiOrigin() {
    return `http://${appConfig.host}:${appConfig.apiPort}`;
}
