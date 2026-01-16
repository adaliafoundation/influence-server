const fs = require('fs');
const { expect } = require('chai');
const sinon = require('sinon');
const InfuraIpfs = require('@common/lib/Ipfs/Infura');

describe('InfuraIpfs', function () {
  let sandbox;

  before(function () {
    sandbox = sinon.createSandbox();
  });

  afterEach(function () {
    sandbox.restore();
  });

  describe('addData', function () {
    it('should attempt to upload the specified data', async function () {
      const ipfs = new InfuraIpfs();
      sandbox.stub(ipfs, '_add').resolves({ data: { Hash: 'ABC', error: null } });
      const data = 'foo';
      const d = await ipfs.addData(data);
      const formData = new FormData(); // eslint-disable-line no-undef
      formData.append('file', data);

      expect(d).to.eql({ hash: 'ABC' });
      expect(ipfs._add.calledOnce).to.eql(true);
      expect(ipfs._add.calledWith(formData)).to.eql(true);
    });
  });

  describe('addFile', function () {
    it('should attempt to upload the specified file', async function () {
      const ipfs = new InfuraIpfs();
      sandbox.stub(ipfs, '_add').resolves({ data: { Hash: 'ABC', error: null } });
      const d = await ipfs.addData(__filename);
      const formData = new FormData(); // eslint-disable-line no-undef
      formData.append('file', fs.createReadStream(__filename));

      expect(d).to.eql({ hash: 'ABC' });
      expect(ipfs._add.calledOnce).to.eql(true);
      expect(ipfs._add.calledWith(formData)).to.eql(true);
    });
  });
});
