const { expect } = require('chai');
const Entity = require('@common/lib/Entity');

describe('Entity', function () {
  describe('constructor', function () {
    it('should return a correctly formatted entity', function () {
      let result;
      const expected = { id: 1, label: 1, uuid: '0x10001' };

      result = new Entity({ id: 1, label: 1 });
      expect(result).to.deep.equal(expected);

      result = new Entity({ uuid: '0x10001' });
      expect(result).to.deep.equal(expected);

      result = new Entity({ id: 1, label: 1, uuid: '0x10001' });
      expect(result).to.deep.equal(expected);
    });

    it('should throw an error if no uuid or id/label are provided or invalid', function () {
      let fn = function () {
        return new Entity();
      };
      expect(fn).to.throw();

      fn = function () {
        return new Entity({ id: 1 });
      };
      expect(fn).to.throw();

      fn = function () {
        return new Entity({ label: 1 });
      };
      expect(fn).to.throw();

      fn = function () {
        return new Entity({ uuid: 'asdfsadf' });
      };
      expect(fn).to.throw();
    });
  });

  describe('toObject', function () {
    it('should return a plain object with id, label and uuid', function () {
      let result = (new Entity({ id: 1, label: 1 })).toObject();
      expect(result).to.eql({ id: 1, label: 1, uuid: '0x10001' });

      result = (new Entity({ uuid: '0x10001' })).toObject();
      expect(result).to.eql({ id: 1, label: 1, uuid: '0x10001' });
    });
  });

  describe('unpackLot', function () {
    it('should unpack the packed id if the entity is a lot', function () {
      const result = new Entity({ id: 6881662889623553, label: 4 }).unpackLot();
      expect(result).to.eql({
        asteroidEntity: { id: 1, label: 3, uuid: '0x10003' },
        asteroidId: 1,
        lotId: 1602262,
        lotIndex: 1602262
      });
    });

    it('should throw an error if the entity is not a lot type entity', function () {
      const fn = function () {
        return (new Entity({ id: 1, label: 1 })).unpackLot();
      };
      expect(fn).to.throw();
    });
  });

  describe('isCrew', function () {
    it('should return true if the entity is type Crew', function () {
      const result = (new Entity({ id: 1, label: 1 })).isCrew();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Crew', function () {
      const result = (new Entity({ id: 1, label: 2 })).isCrew();
      expect(result).to.eql(false);
    });
  });

  describe('isCrewmate', function () {
    it('should return true if the entity is type Crewmate', function () {
      const result = (new Entity({ id: 1, label: 2 })).isCrewmate();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Crewmate', function () {
      const result = (new Entity({ id: 1, label: 1 })).isCrewmate();
      expect(result).to.eql(false);
    });
  });

  describe('isAsteroid', function () {
    it('should return true if the entity is type Asteroid', function () {
      const result = (new Entity({ id: 1, label: 3 })).isAsteroid();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Asteroid', function () {
      const result = (new Entity({ id: 1, label: 1 })).isAsteroid();
      expect(result).to.eql(false);
    });
  });

  describe('isLot', function () {
    it('should return true if the entity is type Lot', function () {
      const result = (new Entity({ id: 1, label: 4 })).isLot();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Lot', function () {
      const result = (new Entity({ id: 1, label: 1 })).isLot();
      expect(result).to.eql(false);
    });
  });

  describe('isBuilding', function () {
    it('should return true if the entity is type Building', function () {
      const result = (new Entity({ id: 1, label: 5 })).isBuilding();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Building', function () {
      const result = (new Entity({ id: 1, label: 1 })).isBuilding();
      expect(result).to.eql(false);
    });
  });

  describe('isShip', function () {
    it('should return true if the entity is type Ship', function () {
      const result = (new Entity({ id: 1, label: 6 })).isShip();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Ship', function () {
      const result = (new Entity({ id: 1, label: 1 })).isShip();
      expect(result).to.eql(false);
    });
  });

  describe('isDeposit', function () {
    it('should return true if the entity is type Deposit', function () {
      const result = (new Entity({ id: 1, label: 7 })).isDeposit();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Deposit', function () {
      const result = (new Entity({ id: 1, label: 1 })).isDeposit();
      expect(result).to.eql(false);
    });
  });

  describe('isDelivery', function () {
    it('should return true if the entity is type Delivery', function () {
      const result = (new Entity({ id: 1, label: 9 })).isDelivery();
      expect(result).to.eql(true);
    });

    it('should return false if the entity is not type Delivery', function () {
      const result = (new Entity({ id: 1, label: 1 })).isDelivery();
      expect(result).to.eql(false);
    });
  });

  describe('IDS getter (static)', function () {
    it('should return the entity IDS map', function () {
      expect(Entity.IDS).to.be.a('object');
      expect(Object.keys(Entity.IDS)).to.have.lengthOf(9);
    });
  });

  describe('fromUuid (static)', function () {
    it('should create an entity from a uuid', function () {
      expect(Entity.fromUuid('0x10001')).to.eql({ id: 1, label: 1, uuid: '0x10001' });
    });
  });

  describe('toUuid (static)', function () {
    it('should return the correct uuid for the specified id and label', function () {
      expect(Entity.toUuid(1, 1)).to.eql('0x10001');
      expect(Entity.toUuid(1, 2)).to.eql('0x10002');
      expect(Entity.toUuid(1, 3)).to.eql('0x10003');
      expect(Entity.toUuid(4294967297, 4)).to.eql('0x1000000010004');
    });

    it('should throw an error if the id or label are missing', function () {
      let fn = function () {
        return Entity.toUuid();
      };
      expect(fn).to.throw();

      fn = function () {
        return Entity.toUuid(1);
      };
      expect(fn).to.throw();

      fn = function () {
        return Entity.toUuid(null, 1);
      };
      expect(fn).to.throw();
    });
  });

  describe('fromIdAndLabel (static)', function () {
    it('should create an entity from an id and label', function () {
      expect(Entity.fromIdAndLabel(1, 1)).to.eql({ id: 1, label: 1, uuid: '0x10001' });
    });
  });

  describe('toEntity (static)', function () {
    it('should create an entity from a valid object', function () {
      expect(Entity.toEntity({ id: 1, label: 1 })).to.eql({ id: 1, label: 1, uuid: '0x10001' });
      expect(Entity.toEntity({ uuid: '0x10001' })).to.eql({ id: 1, label: 1, uuid: '0x10001' });
    });
  });

  describe('lotFromIndex (static)', function () {
    it('should create a Lot entity from an asteroidId and lot index', function () {
      expect(Entity.lotFromIndex(1, 1)).to.eql({ id: 4294967297, label: 4, uuid: '0x1000000010004' });
    });
  });

  describe('Crew (static)', function () {
    it('should create crew type entity', function () {
      expect(Entity.Crew(1)).to.eql({ id: 1, label: 1, uuid: '0x10001' });
    });
  });

  describe('Crewmate (static)', function () {
    it('should create crewmate type entity', function () {
      expect(Entity.Crewmate(1)).to.eql({ id: 1, label: 2, uuid: '0x10002' });
    });
  });

  describe('Asteroid (static)', function () {
    it('should create asteroid type entity', function () {
      expect(Entity.Asteroid(1)).to.eql({ id: 1, label: 3, uuid: '0x10003' });
    });
  });

  describe('Lot (static)', function () {
    it('should create lot type entity', function () {
      expect(Entity.Lot(1)).to.eql({ id: 1, label: 4, uuid: '0x10004' });
    });
  });

  describe('Building (static)', function () {
    it('should create building type entity', function () {
      expect(Entity.Building(1)).to.eql({ id: 1, label: 5, uuid: '0x10005' });
    });
  });

  describe('Ship (static)', function () {
    it('should create ship type entity', function () {
      expect(Entity.Ship(1)).to.eql({ id: 1, label: 6, uuid: '0x10006' });
    });
  });

  describe('Deposit (static)', function () {
    it('should create deposit type entity', function () {
      expect(Entity.Deposit(1)).to.eql({ id: 1, label: 7, uuid: '0x10007' });
    });
  });

  describe('Delivery (static)', function () {
    it('should create deliver type entity', function () {
      expect(Entity.Delivery(1)).to.eql({ id: 1, label: 9, uuid: '0x10009' });
    });
  });
});
