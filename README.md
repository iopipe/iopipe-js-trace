# IOpipe Trace Plugin

[![styled with prettier](https://img.shields.io/badge/styled_with-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

Create marks and measures for arbitrary units of time. Measure latency of database calls, third party requests, or code blocks and visualize them in [IOpipe](https://iopipe.com)!

## Requirements
- Node >= `4.3.2`
- NPM >= `2.14.12`
- IOpipe >= `0.8.0`

## Install

With [yarn](https://yarnpkg.com) (recommended) in project directory:

`yarn add iopipe-plugin-trace`

With npm in project directory:

`npm install iopipe-plugin-trace`

Then include the plugin with IOpipe in your serverless function:

```js
const iopipeLib = require('iopipe');
const tracePlugin = require('iopipe-plugin-trace');

const iopipe = iopipeLib({
  token: 'TOKEN_HERE',
  plugins: [tracePlugin()]
});

// wrap your lambda handler
exports.handler = iopipe((event, context) => {
  context.iopipe.mark.start('database');
  // after database call is finished
  context.iopipe.mark.end('database');

  context.iopipe.mark.start('analytics');
  // after analytics call is finished
  context.iopipe.mark.end('analytics');
  context.succeed('Wow!');
});
```

## Methods

```js
// create the start mark
// the string argument is a name you are assigning the particular trace
context.iopipe.mark.start('db');

// create the end mark
// pass the name of the trace that you want to end
context.iopipe.mark.end('db');

// create an custom measurement between start:init and end:db
context.iopipe.measure('custom', 'init', 'db');
```

## Config

#### `autoMeasure` (bool: optional = true)

By default, the plugin will create auto-measurements for marks with matching `mark.start` and `mark.end`. These measurements will be displayed in the [IOpipe Dashboard](https://dashboard.iopipe.com). If you'd like to turn this off, set `autoMeasure: false`.

```js
const iopipe = iopipeLib({
  plugins: [tracePlugin({
    autoMeasure: false
  })]
});
```

## Contributing
- This project uses [Prettier](https://github.com/prettier/prettier). Please execute `npm run eslint -- --fix` to auto-format the code before submitting pull requests.
