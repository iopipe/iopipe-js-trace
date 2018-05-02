// import originalHttp from 'http';
import _ from 'lodash';
import Perf from 'performance-node';
import { wrap, unwrap } from './shimmerHttp';

beforeEach(() => {
  unwrap();
  // delete require.cache[require.resolve('http')];
  // delete require.cache[require.resolve('https')];
  // delete require.cache[require.resolve('./shimmerHttp')];
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
  const statusCode = 301;

  http.get(href, res => {
    expect(res.statusCode).toBe(statusCode);

    const dataValues = _.values(data);
    expect(dataValues).toHaveLength(1);
    const [obj] = dataValues;

    expect(obj.href).toBe(href);
    expect(obj.req.headers).toEqual({});
    expect(obj.res.headers['content-type']).toBe('text/plain');
    expect(obj.res.statusCode).toBe(statusCode);

    const entries = timeline.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toMatch(/^start:(.){36}$/);
    expect(entries[1].name).toMatch(/^end:(.){36}$/);

    done();
  });
});

test('Wrap works with http.get(opts)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const http = require('http');
  const href = 'http://iopipe.com?http.get(opts)';
  const statusCode = 301;

  http.get(
    {
      protocol: 'http:',
      host: 'iopipe.com',
      search: '?http.get(opts)',
      headers: { 'x-iopipe-test': 'foo, bar' }
    },
    res => {
      expect(res.statusCode).toBe(statusCode);

      const dataValues = _.values(data);
      expect(dataValues).toHaveLength(1);
      const [obj] = dataValues;

      expect(obj.href).toBe(href);
      expect(obj.req.headers).toEqual({ 'x-iopipe-test': 'foo, bar' });
      expect(obj.res.headers['content-type']).toBe('text/plain');
      expect(obj.res.statusCode).toBe(statusCode);

      expect(timeline.getEntries()).toHaveLength(2);

      done();
    }
  );
});

test('Wrap works with https.get(string)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const https = require('https');
  const href = 'https://iopipe.com?https.get(string)';
  const statusCode = 301;

  https.get(href, res => {
    expect(res.statusCode).toBe(statusCode);

    const dataValues = _.values(data);
    expect(dataValues).toHaveLength(1);
    const [obj] = dataValues;

    expect(obj.href).toBe(href);
    expect(obj.req.headers).toEqual({});
    expect(obj.res.headers['content-type']).toBe('text/plain');
    expect(obj.res.statusCode).toBe(statusCode);

    const entries = timeline.getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toMatch(/^start:(.){36}$/);
    expect(entries[1].name).toMatch(/^end:(.){36}$/);

    done();
  });
});

test('Wrap works with https.request(url)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const https = require('https');
  const href = 'https://iopipe.com?https.request(url)';
  const statusCode = 301;

  https
    .request(href, (res, err) => {
      expect(res.statusCode).toBe(statusCode);

      const dataValues = _.values(data);
      expect(dataValues).toHaveLength(1);
      const [obj] = dataValues;

      expect(obj.href).toBe(href);
      expect(obj.req.headers).toEqual({});
      expect(obj.res.headers['content-type']).toBe('text/plain');
      expect(obj.res.statusCode).toBe(statusCode);

      const entries = timeline.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].name).toMatch(/^start:(.){36}$/);
      expect(entries[1].name).toMatch(/^end:(.){36}$/);

      done();
    })
    .end();
});

test('Wrap works with https.request(opts)', done => {
  const timeline = new Perf({ timestamp: true });
  const data = {};
  wrap({ timeline, data });

  const https = require('https');
  const statusCode = 301;

  https
    .request(
      {
        hostname: 'iopipe.com',
        protocol: 'https:',
        search: '?https.request(opts)'
      },
      (res, err) => {
        expect(res.statusCode).toBe(statusCode);

        const dataValues = _.values(data);
        expect(dataValues).toHaveLength(1);
        const [obj] = dataValues;

        expect(obj.href).toBe('https://iopipe.com?https.request(opts)');
        expect(obj.req.headers).toEqual({});
        expect(obj.res.headers['content-type']).toBe('text/plain');
        expect(obj.res.statusCode).toBe(statusCode);

        const entries = timeline.getEntries();
        expect(entries).toHaveLength(2);
        expect(entries[0].name).toMatch(/^start:(.){36}$/);
        expect(entries[1].name).toMatch(/^end:(.){36}$/);

        done();
      }
    )
    .end();
});
