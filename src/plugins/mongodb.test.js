import Perf from 'performance-node';
import { MongoClient } from 'mongodb';
import { wrap, unwrap } from './mongodb';

const dbUrl = 'mongodb://localhost:27017';

const timelineExpect = (timeline, data, mongoData) => {
  const { commandName, dbName, collection } = mongoData;
  const entries = timeline.getEntries();
  expect(entries.length).toBeGreaterThan(0);
  const lastStart = entries.length - 2;
  const lastEnd = entries.length - 1;

  expect(entries[lastStart].name).toMatch(/^start:mongodb-(.){36}$/);
  expect(entries[lastEnd].name).toMatch(/^end:mongodb-(.){36}$/);

  const entryId = entries[lastEnd].name.substr(4);

  const dataKeys = Object.keys(data);
  expect(dataKeys.length).toBeGreaterThan(0);

  const trace = data[entryId];
  expect(trace).toBeDefined();
  expect(trace.name).toBeDefined();
  expect(trace.name).toBe(commandName);
  expect(trace.dbType).toBe('mongodb');
  expect(trace.request.key).toBeDefined();
  expect(trace.request.db).toBe(dbName);
  expect(trace.request.hostname).toBeDefined();
  expect(trace.request.port).toBeDefined();
  expect(trace.request.hostname).not.toBeNull();
  expect(trace.request.port).not.toBeNull();

  if (collection) {
    expect(trace.request.table).toBe(collection);
  }
};

/* Convenience methods around MongoDb functions, used to test unwrapped and wrapped: */
const createClient = () =>
  new MongoClient(dbUrl, { useNewUrlParser: true, useUnifiedTopology: true });

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

const deleteDocument = (document, collectionName, db, callback) => {
  const collection = db.collection(collectionName);
  collection.deleteOne(document, (err, result) => {
    callback(err, result);
  });
};

const mockMongoStore = {};

const mockGet = key => {
  const keyArray = Object.keys(mockMongoStore);
  if (keyArray.indexOf(key) === -1) {
    return undefined;
  }
  return mockMongoStore[key];
};

const mockSet = obj => {
  const key = Object.keys(obj).join('');
  mockMongoStore[key] = obj;
  return obj;
};

/*eslint-disable babel/no-invalid-this*/
/*eslint-disable func-name-matching */
/*eslint-disable prefer-rest-params */
/*eslint-disable func-names */
/*eslint-disable camelcase */
/*eslint-disable babel/new-cap */

const mockMongoDb = jest.fn();
mockMongoDb.mockImplementation(function() {
  const context = this;
  this.insert = jest.fn(obj => mockSet(obj));
  this.find = jest.fn(key => mockGet(key));
  this.close = jest.fn(() => {});
  this.Connection = jest.fn(() => {});
  this.Server = jest.fn(() => {});
  this.MongoClient = jest.fn(() => context);
});

test('Basic mongodb mock works as normal if wrap is not called', () => {
  const c = new mockMongoDb();
  const expectedStr = 'mock mongo test';
  expect(c.__iopipeShimmer).toBeUndefined();
  c.insert({ testString: expectedStr });
  const returnedValue = c.find('testString');
  expect(returnedValue.testString).toBe(expectedStr);
  c.close();
});

xdescribe('MongoDb works as normal if wrap is not called', () => {
  const dbName = 'iopipeTestDb';
  const collection = 'iopipeTestCollection';
  /*
  // beforeAll and afterAll are run even if this suite is disabled.
  // uncomment to run against local MongoDB
  beforeAll(done => {
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      return deleteDocument({}, collection, db, err => {
        db.dropCollection(collection);
        c.close();
        done(err);
      });
    });
  });

  afterAll(done => {
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      return deleteDocument({}, collection, db, err => {
        c.close();
        done(err);
      });
    });
  });
  // */

  test('Unwrapped client is not wrapped', () => {
    expect(MongoClient.__wrapped).toBeUndefined();
  });

  test('Client can connect and close connection', done => {
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      expect(client.__iopipeTraceId).toBeUndefined();
      expect(client.__wrapped).toBeUndefined();
      c.close();
      return done(clErr);
    });
  });
  test('Client can insert documents', done => {
    const c = createClient();
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
    const c = createClient();
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
    const c = createClient();
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
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      deleteDocument({ b: 2 }, collection, db, (err, results) => {
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

test('Bails if timeline is not instance of performance-node', async () => {
  const bool = await wrap({ timeline: [] });
  expect(bool).toBe(false);
});

describe('Wrapping MongoDB Mock', () => {
  afterEach(() => {
    unwrap();
  });

  test('Mocking MongoDB to pass CircleCI', () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    wrap({ timeline, data });
    const c = new mockMongoDb();
    const expectedStr = 'wrapping MongoDB mock';
    c.insert({ testString: expectedStr });
    const returnedValue = c.find('testString');
    expect(returnedValue.testString).toBe(expectedStr);
    c.close();
    // not doing timelineExpect because mock doesn't affect timeline
  });
});

xdescribe('Wrapping MongoDB', () => {
  const dbName = 'iopipeTestDb';
  const collection = 'iopipeTestWrapCollection';
  /*
  // beforeAll/afterAll/afterEach are still run, even if this suite is disabled.
  // uncomment this block for testing with local MongoDB
  beforeAll(done => {
    // removing everything before tests
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      return deleteDocument({}, collection, db, err => {
        done(err);
      });
    });
  });
  afterEach(done => {
    unwrap();
    return done();
  });
  afterAll(done => {
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      return deleteDocument({}, collection, db, err => {
        try {
          db.dropCollection(collection);
        } catch (e) {
          console.error(e); //eslint-disable-line no-console
        }
        done(err);
      });
    });
  });
  // */
  test('Wrap works with connect', async () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    await wrap({ timeline, data });
    const c = createClient();
    expect(c.__iopipeShimmer).toBe(true);
    return c.connect(err => {
      expect(err).toBeNull();
      timelineExpect(timeline, data, {
        commandName: 'connect',
        dbName: 'admin'
      });
      return c.close();
      //return done(err);
    });
  });
  test('Wrap generates traces for insert', async () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    expect(timeline.data).toHaveLength(0);
    await wrap({ timeline, data });
    const c = createClient();
    expect(c.__iopipeShimmer).toBe(true);
    c.connect(async (clErr, client) => {
      expect(clErr).toBeNull();

      const documents = [{ a: 1 }, { b: 2 }, { c: 3 }];
      const db = client.db(dbName);

      await insertDocuments(documents, collection, db, (err, result) => {
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
        return c.close();
        // return done(err);
      });
    });
  });
  test('Wrap generates traces for find', async () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    await wrap({ timeline, data });
    expect(timeline.data).toHaveLength(0);
    const c = createClient();
    expect(c.__iopipeShimmer).toBe(true);
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      findDocuments({ a: 1 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toHaveLength(1);

        // find returns a cursor and doesn't take a callback, so doesn't write an end trace
        timelineExpect(timeline, data, {
          commandName: 'toArray',
          dbName,
          collection
        });
        return c.close();
        //return done(err);
      });
    });
  });
  test('Wrap generates traces for update', async () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    await wrap({ timeline, data });
    expect(timeline.data).toHaveLength(0);
    const c = createClient();
    c.connect(async (clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      await updateDocument(
        { a: 1 },
        { a: 7 },
        collection,
        db,
        (err, results) => {
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
          return c.close();
          // return done(err);
        }
      );
    });
  });
  test('Wrap generates traces for delete', async () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    await wrap({ timeline, data });
    expect(timeline.data).toHaveLength(0);
    const c = createClient();
    c.connect((clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);

      deleteDocument({ b: 2 }, collection, db, (err, results) => {
        expect(err).toBeNull();
        expect(results).toBeDefined();
        expect(results.result.n).toBe(1);
        expect(results.result.ok).toBe(1);

        timelineExpect(timeline, data, {
          commandName: 'deleteOne',
          dbName,
          collection
        });
        return c.close();
        // return done(err);
      });
    });
  });
  test('Client can trace bulk writes', async () => {
    const timeline = new Perf({ timestamp: true });
    const data = {};
    await wrap({ timeline, data });
    expect(timeline.data).toHaveLength(0);
    const c = createClient();
    c.connect(async (clErr, client) => {
      expect(clErr).toBeNull();
      const db = client.db(dbName);
      const col = db.collection(collection);
      await col.bulkWrite(
        [
          { insertOne: { document: { a: 1 } } },
          {
            updateOne: {
              filter: { a: 2 },
              update: { $set: { a: 2 } },
              upsert: true
            }
          },
          {
            updateMany: {
              filter: { a: 2 },
              update: { $set: { a: 2 } },
              upsert: true
            }
          },
          { deleteOne: { filter: { c: 1 } } },
          { deleteMany: { filter: { c: 1 } } },
          {
            replaceOne: {
              filter: { c: 3 },
              replacement: { c: 4 },
              upsert: true
            }
          }
        ],
        { ordered: true, w: 1 },
        (err, response) => {
          expect(err).toBeNull();
          expect(response).not.toBeNull();
          c.close();
        }
      );

      const dataKeys = Object.keys(data);
      const lastEntry = dataKeys.length - 1;
      const lastKey = dataKeys[lastEntry];
      const bulkCommands = [
        'insertOne',
        'updateOne',
        'updateMany',
        'deleteOne',
        'deleteMany',
        'replaceOne',
        'ordered',
        'w'
      ].join(', ');

      expect(data[lastKey].name).toBe('bulkWrite');
      expect(data[lastKey].request.bulkCommands).toBeDefined();
      expect(data[lastKey].request.bulkCommands).toBe(bulkCommands);
      return data;
    });
  });
});
