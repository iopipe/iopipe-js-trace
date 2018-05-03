import _ from 'lodash';
import Perf from 'performance-node';
import { wrap, unwrap } from './shimmerHttp';

function iopipeComExpect(
  res,
  { statusCode = 301, href = '', timeline, data, headers = {} }
) {
  expect(res.statusCode).toBe(statusCode);

  const dataValues = _.values(data);
  expect(dataValues).toHaveLength(1);
  const [obj] = dataValues;

  expect(obj.href).toBe(href);
  expect(obj.req.headers).toEqual(headers);
  expect(obj.res.headers['content-type']).toBe('text/plain');
  expect(obj.res.statusCode).toBe(statusCode);

  const entries = timeline.getEntries();
  expect(entries).toHaveLength(2);
  expect(entries[0].name).toMatch(/^start:(.){36}$/);
  expect(entries[1].name).toMatch(/^end:(.){36}$/);
}

beforeEach(() => {
  unwrap();
});

test('Http works as normal if wrap is not called', done => {
  const http = require('http');
  expect(http.get.__wrapped).toBeUndefined();
  http.get('http://iopipe.com?normalHttp', res => {
    expect(res.statusCode).toBe(301);
    done();
  });
});

test('Https works as normal if wrap is not called', done => {
  const https = require('https');
  expect(https.get.__wrapped).toBeUndefined();
  https.get('https://www.iopipe.com?normalHttps', res => {
    expect(res.statusCode).toBe(200);
    done();
  });
});

test('Bails if timeline is not instance of performance-node', () => {
  const bool = wrap({ timeline: [] });
  expect(bool).toBe(false);
});

test('Wrap works with http.get(string)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const http = require('http');
  const href = 'http://iopipe.com?http.get(string)';

  http.get(href, res => {
    iopipeComExpect(res, { data, timeline, href });
    done();
  });
});

test('Wrap works with http.get(opts)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const http = require('http');
  const href = 'http://iopipe.com?http.get(opts)';
  const headers = { 'x-iopipe-test': 'foo, bar' };
  http.get(
    {
      protocol: 'http:',
      host: 'iopipe.com',
      search: '?http.get(opts)',
      headers
    },
    res => {
      iopipeComExpect(res, { data, timeline, href, headers });
      done();
    }
  );
});

test('Wrap works with http.request(url)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const http = require('http');
  const href = 'http://iopipe.com?http.request(url)';

  http
    .request(href, res => {
      iopipeComExpect(res, { data, timeline, href });
      done();
    })
    .end();
});

test('Wrap works with http.request(opts)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const http = require('http');
  const href = 'http://iopipe.com?http.request(opts)';
  const headers = { 'x-iopipe-test': 'foo, bar' };
  http
    .request(
      {
        protocol: 'http:',
        host: 'iopipe.com',
        search: '?http.request(opts)',
        headers
      },
      res => {
        iopipeComExpect(res, { data, timeline, href, headers });
        done();
      }
    )
    .end();
});

test('Wrap works with https.get(string)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const https = require('https');
  const href = 'https://iopipe.com?https.get(string)';

  https.get(href, res => {
    iopipeComExpect(res, { data, timeline, href });
    done();
  });
});

test('Wrap works with https.request(url)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const https = require('https');
  const href = 'https://iopipe.com?https.request(url)';

  https
    .request(href, res => {
      iopipeComExpect(res, { data, timeline, href });
      done();
    })
    .end();
});

test('Wrap works with https.request(opts)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const https = require('https');
  const href = 'https://iopipe.com?https.request(opts)';

  https
    .request(
      {
        hostname: 'iopipe.com',
        protocol: 'https:',
        search: '?https.request(opts)'
      },
      res => {
        iopipeComExpect(res, { data, timeline, href });
        done();
      }
    )
    .end();
});

test('Wrap works with async got(string)', async () => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const got = require('got');
  const href = 'http://iopipe.com?got(string)';

  const res = await got(href);
  expect(res.statusCode).toBe(200);
  expect(res.headers).toHaveProperty('content-type');
  expect(res.headers).toHaveProperty('server');
  const entries = timeline.getEntries();
  expect(entries).toHaveLength(4);
  // got follows redirects automatically
  // ensure 2 requests in trace data
  const ids = _.chain(entries)
    .map('name')
    .map(str => str.replace(/(start|end):/, ''))
    .uniq()
    .value();
  expect(ids).toHaveLength(2);
});
