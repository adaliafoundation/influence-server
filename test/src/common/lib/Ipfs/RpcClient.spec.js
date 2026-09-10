const { expect } = require('chai');
const sinon = require('sinon');
const axios = require('axios');
const Ipfs = require('@common/lib/Ipfs/Ipfs');
const IpfsRpcClient = require('@common/lib/Ipfs/RpcClient');

const expectFailure = async (operation, status, message) => {
  try {
    await operation();
  } catch (error) {
    expect(error.status).to.equal(status);
    expect(error.message).to.equal(message);
    return;
  }
  throw new Error('Expected operation to fail');
};

const payloads = [{ content: 'Influence 🚀' }, 'a'.repeat(262145)];

describe('IpfsRpcClient', function () {
  afterEach(function () {
    sinon.restore();
  });

  for (const content of payloads) {
    it(`uploads exact bytes and verifies the CID (${typeof content})`, async function () {
      const serialized = Ipfs.serialize(content);
      const hash = await Ipfs.hashData(serialized);
      const post = sinon.stub(axios, 'post').resolves({ data: { Hash: hash } });
      const client = new IpfsRpcClient({ endpoint: 'https://rpc.example/api/v0/', authorization: 'Bearer secret' });
      expect(await client.addData(content)).to.deep.equal({ hash });
      const [url, form, options] = post.firstCall.args;
      expect(url).to.equal('https://rpc.example/api/v0/add');
      expect(await form.get('file').text()).to.equal(serialized);
      expect(form.get('file').name).to.equal('content.json');
      expect(options.headers).to.deep.equal({ Authorization: 'Bearer secret' });
      expect(options.params).to.deep.equal({
        pin: true,
        quieter: true,
        'cid-version': 0,
        'raw-leaves': false,
        'wrap-with-directory': false,
        chunker: 'size-262144',
        hash: 'sha2-256'
      });
    });
  }

  it('allows private RPC without authentication', async function () {
    const hash = await Ipfs.hashData('test');
    const post = sinon.stub(axios, 'post').resolves({ data: { Hash: hash } });
    await new IpfsRpcClient({ authorization: null }).addData('test');
    expect(post.firstCall.args[2].headers).to.deep.equal({});
  });

  it('rejects unconfigured uploads without making requests', async function () {
    const post = sinon.stub(axios, 'post');
    const client = new IpfsRpcClient({ endpoint: null });
    await expectFailure(() => client.addData('test'), 503, 'IPFS storage is not configured');
    expect(post.called).to.equal(false);
    expect(await Ipfs.hashData('test')).to.be.a('string');
  });

  it('rejects a mismatched CID', async function () {
    sinon.stub(axios, 'post').resolves({ data: { Hash: 'wrong' } });
    await expectFailure(() => new IpfsRpcClient().addData('test'), 502, 'IPFS upload returned an unexpected CID');
  });

  it('does not expose upstream credentials or payloads in errors', async function () {
    sinon.stub(axios, 'post').rejects(new Error('Bearer secret and private payload'));
    await expectFailure(() => new IpfsRpcClient().addData('test'), 502, 'IPFS upload failed');
  });
});
