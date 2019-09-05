import Perf from 'performance-node';
import { MongoClient } from 'mongodb';
import { wrap, unwrap } from './mongodb';

const dbUrl = 'mongodb://localhost:27017';

const timelineExpect = (timeline, data, mongoData) => {
  const { commandName, dbName, collection } = mongoData;
  let idx = 2;
  // all tests connect, and most first define db.
  if (commandName === 'connect') {
    idx = 0;
  } else if (commandName === 'db') {
    idx = 1;
  }

  const entries = timeline.getEntries();
  expect(entries.length).toBeGreaterThan(0);
  expect(entries[idx].name).toMatch(/^start:mongodb-(.){36}$/);

  const dataKeys = Object.keys(data);
  expect(dataKeys.length).toBeGreaterThan(0);
  const trace = data[dataKeys[idx]];
  expect(trace.name).toBeDefined();
  expect(trace.name).toBe(commandName);
  expect(trace.dbType).toBe('MongoDb');
  expect(trace.request.key).toBeDefined();
  expect(trace.request.db).toBe(dbName);

  if (collection) {
    expect(trace.request.table).toBe(collection);
  }
};

/* Convenience methods around MongoDb functions, used to test unwrapped and wrapped: */

const insertDocuments = (documents, collectionName, db, callback) => {
  const collection = db.collection(collectionName);
  collection.insertMany(documents, (err, result) => {
    callback(err, result);
  });
};

const updateDocument = (document, update, collectionName, db, callback) => {
  const collection = db.collection(collectionName);
  collection.updateOne(document, { $set: update }, (err, result) => {
    callback(err, result);
  });
};

const findDocuments = (match, collectionName, db, callback) => {
  const collection = db.collection(collectionName);
  collection.find(match).toArray((err, docs) => {
    callback(err, docs);
  });
};

const removeDocument = (document, collectionName, db, callback) => {
  const collection = db.collection(collectionName);
  collection.remove(document, (err, result) => {
    callback(err, result);
  });
};

const dropCollection = (collectionName, db, callback) => {
  // guarding against mongo error when collection doesn't exist
  if (
    !db.s ||
    !db.s.namespace ||
    !db.s.namespace.collection ||
    db.s.namespace.collection !== collectionName
  ) {
    return callback(null, true);
  }

  try {
    return db
      .collection(collectionName)
      .drop({}, (err, result) => callback(err, result));
  } catch (e) {
    return callback(e);
  }
};

const mockMongoStore = {};

const mockGet = key => {
  const keyArray = Object.keys(mockMongoStore);
  if (keyArray.indexOf(key) === -1) {
    return undefined;
  }
  return mockMongoStore[key];
};

const mockSet = (key, val) => {
  mockMongoStore[key] = val;
  return { key: val };
};

// jest.mock('mongodb').default;

xtest('Basic mongodb mock works as normal if wrap is not called', () => {
  const c = new MongoClient(dbUrl);

  c.insert = jest.fn((key, val) => mockSet(key, val));
  c.find = jest.fn(key => mockGet(key));

  const expectedStr = 'mock mongo test';
  expect(c.insert.__wrapped).toBeUndefined();
  c.insert({ testString: expectedStr });

  const returnedValue = c.find();
  expect(returnedValue.testString).toBe(expectedStr);
});

describe('MongoDb works as normal if wrap is not called', () => {
  const dbName = 'iopipeTestDb';
  const collection = 'iopipeTestCollection';

  afterAll(done => {
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      dropCollection(collection, db, err => {
        expect(err).toBeNull();
        c.close();
        done(err);
      });
    });
  });

  test('Unwrapped client is not wrapped', () => {
    expect(MongoClient.__wrapped).toBeUndefined();
  });

  test('Client can connect and close connection', done => {
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      expect(client.__iopipeTraceId).toBeUndefined();
      expect(client.__wrapped).toBeUndefined();
      c.close();
      return done(clErr);
    });
  });
  test('Client can insert documents', done => {
    const c = new MongoClient(dbUrl);
    expect(c.__wrapped).toBeUndefined();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();

      const documents = [{ a: 1 }, { b: 2 }, { c: 3 }];
      const db = client.db(dbName);

      insertDocuments(documents, collection, db, (err, result) => {
        expect(err).toBeNull();
        expect(result).toBeDefined();
        expect(result.result.ok).toBe(1);
        expect(result.result.n).toBe(documents.length);
        expect(result.ops).toHaveLength(documents.length);
        expect(result.insertedCount).toBe(documents.length);
        c.close();
        return done(err);
      });
    });
  });
  test('Client can get a document', done => {
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      findDocuments({ a: 1 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toHaveLength(1);
        c.close();
        return done(err);
      });
    });
  });
  test('Client can set a property', done => {
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      updateDocument({ a: 1 }, { a: 7 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toBeDefined();
        expect(results.result.n).toBe(1);
        expect(results.result.nModified).toBe(1);
        expect(results.result.ok).toBe(1);
        c.close();
        return done(err);
      });
    });
  });

  test('Client can delete the document', done => {
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      removeDocument({ b: 2 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toBeDefined();
        expect(results.result.n).toBe(1);
        expect(results.result.ok).toBe(1);
        c.close();
        return done(err);
      });
    });
  });
});

test('Bails if timeline is not instance of performance-node', () => {
  const bool = wrap({ timeline: [] });
  expect(bool).toBe(false);
});

xdescribe('Wrapping mongo Mock', () => {
  let client;

  afterEach(() => {
    unwrap();
  });

  afterAll(() => {
    client.quit();
  });

  test('Mocking mongo to pass CircleCI', () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};

    wrap({ timeline, data });

    client = new MongoClient({ db: 2 });

    client.set = jest.fn((key, val) => mockSet(key, val));
    client.get = jest.fn(key => mockGet(key));

    const expectedStr = 'wrapping mongo mock';
    client.set('testString', expectedStr);

    const returnedValue = client.get('testString');
    expect(returnedValue).toBe(expectedStr);

    // not doing timelineExpect because mock doesn't affect timeline
  });
});

describe('Wrapping MongoDb', () => {
  const dbName = 'iopipeTestDb';
  const collection = 'iopipeTestWrapCollection';

  beforeAll(done => {
    // removing everything before tests
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      return removeDocument({}, collection, db, err => {
        done(err);
      });
    });
  });

  afterEach(done => {
    unwrap();
    return done();
  });

  afterAll(done => {
    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      new Promise((resolve, reject) => {
        return dropCollection(collection, db, (err, result) => {
          expect(err).toBeNull();
          if (err) {
            reject(err);
          }
          return resolve(result);
        });
      }).then(() => {
        c.close();
        done();
      });
    });
  });

  test('Wrap works with connect', done => {
    const timeline = new Perf({ timestamp: true });
    const data = {};

    wrap({ timeline, data });

    const c = new MongoClient(dbUrl);

    expect(c.__iopipeShimmer).toBe(true);

    c.connect(err => {
      expect(err).toBeNull();

      timelineExpect(timeline, data, {
        commandName: 'connect',
        dbName: 'admin'
      });

      c.close();
      return done(err);
    });
  });

  test('Wrap works with insert', done => {
    const timeline = new Perf({ timestamp: true });
    const data = {};

    wrap({ timeline, data });

    const c = new MongoClient(dbUrl);
    expect(c.__iopipeShimmer).toBe(true);

    c.connect((clErr, client) => {
      expect(clErr).toBeNull();

      const documents = [{ a: 1 }, { b: 2 }, { c: 3 }];
      const db = client.db(dbName);

      insertDocuments(documents, collection, db, (err, result) => {
        expect(err).toBeNull();
        expect(result.result.ok).toBe(1);
        expect(result.result.n).toBe(documents.length);
        expect(result.ops).toHaveLength(documents.length);
        expect(result.insertedCount).toBe(documents.length);

        timelineExpect(timeline, data, {
          commandName: 'insertMany',
          dbName,
          collection
        });

        c.close();

        return done(err);
      });
    });
  });
  test('Wrap works with find()', done => {
    const timeline = new Perf({ timestamp: true });
    const data = {};

    wrap({ timeline, data });

    expect(timeline.data).toHaveLength(0);

    const c = new MongoClient(dbUrl);
    expect(c.__iopipeShimmer).toBe(true);

    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      findDocuments({ a: 1 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toHaveLength(1);

        timelineExpect(timeline, data, {
          commandName: 'find',
          dbName,
          collection
        });

        c.close();
        return done(err);
      });
    });
  });
  test('Client can update a document', done => {
    const timeline = new Perf({ timestamp: true });
    const data = {};

    wrap({ timeline, data });

    expect(timeline.data).toHaveLength(0);

    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      updateDocument({ a: 1 }, { a: 7 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toBeDefined();
        expect(results.result.n).toBe(1);
        expect(results.result.nModified).toBe(1);
        expect(results.result.ok).toBe(1);

        timelineExpect(timeline, data, {
          commandName: 'updateOne',
          dbName,
          collection
        });

        c.close();
        return done(err);
      });
    });
  });

  test('Client can delete the document', done => {
    const timeline = new Perf({ timestamp: true });
    const data = {};

    wrap({ timeline, data });

    expect(timeline.data).toHaveLength(0);

    const c = new MongoClient(dbUrl);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      removeDocument({ b: 2 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toBeDefined();
        expect(results.result.n).toBe(1);
        expect(results.result.ok).toBe(1);

        timelineExpect(timeline, data, {
          commandName: 'remove',
          dbName,
          collection
        });

        c.close();
        return done(err);
      });
    });
  });
});
