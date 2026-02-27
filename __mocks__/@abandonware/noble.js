'use strict';

// Jest manual mock for @abandonware/noble
// Used automatically by jest.mock('@abandonware/noble') or moduleNameMapper

const noble = {
  state: 'poweredOn',
  startScanning: jest.fn(),
  stopScanning: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  removeListener: jest.fn(),
};

module.exports = noble;
