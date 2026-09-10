const { expect } = require('chai');
const { mkdtemp, readFile, stat, writeFile, symlink, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const mongoose = require('mongoose');
const sinon = require('sinon');
const generateApiKey = require('../../bin/generateApiKey');
const logger = require('../../src/common/lib/logger');

describe('generateApiKey', function () {
  let directory;
  let output;
  beforeEach(async function () {
    directory = await mkdtemp(join(tmpdir(), 'influence-api-key-test-'));
    output = join(directory, 'credentials.json');
  });
  afterEach(async function () {
    sinon.restore();
    await rm(directory, { recursive: true, force: true });
    await this.utils.resetCollections(['ApiKey']);
  });

  it('writes a private usable credential and stores only its hash without logging the secret', async function () {
    const log = sinon.spy(logger, 'info');
    await generateApiKey({ name: 'Test client', output });
    const credential = JSON.parse(await readFile(output, 'utf8'));
    const doc = await mongoose.model('ApiKey').findOne({ client_id: credential.client_id });
    expect(doc.name).to.equal('Test client');
    expect(doc.client_secret).not.to.equal(credential.client_secret);
    expect(doc.validSecret(credential.client_secret)).to.equal(true);
    expect((await stat(output)).mode & 0o777).to.equal(0o600);
    expect(JSON.stringify(log.args)).not.to.include(credential.client_secret);
  });

  it('refuses existing files and symlinks without creating database credentials', async function () {
    const target = join(directory, 'existing.json');
    await writeFile(target, 'existing secret');
    await symlink(target, output);
    for (const path of [target, output]) {
      try {
        await generateApiKey({ name: 'Test client', output: path });
        throw new Error('Expected exclusive file creation to fail');
      } catch (error) { expect(error.code).to.equal('EEXIST'); }
    }
    expect(await readFile(target, 'utf8')).to.equal('existing secret');
    expect(await mongoose.model('ApiKey').countDocuments()).to.equal(0);
  });

  it('removes its new credential file when database creation fails', async function () {
    sinon.stub(mongoose.model('ApiKey'), 'create').rejects(new Error('Database rejected credential'));
    try {
      await generateApiKey({ name: 'Test client', output });
      throw new Error('Expected database failure');
    } catch (error) { expect(error.message).to.equal('Database rejected credential'); }
    try {
      await stat(output);
      throw new Error('Expected failed credential file to be removed');
    } catch (error) { expect(error.code).to.equal('ENOENT'); }
  });
});
