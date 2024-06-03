const path = require('path')
const webpack = require('webpack')

module.exports = {
    mode: 'production',
    target: 'node',
    entry: './scripts/dca/autotask/swap-handler.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
        ],
    },
    plugins: [
        new webpack.IgnorePlugin({
            resourceRegExp: /^pino-pretty$/,
        }),
    ],
    resolve: {
        extensions: ['.ts', '.js'],
        alias: {
            '@src': path.resolve(__dirname, 'src'),
        },
    },
    output: {
        libraryTarget: 'commonjs2',
        filename: 'index.js',
        path: path.resolve(`${ __dirname }/scripts/dca/autotask/`, 'build'),
    },
}
