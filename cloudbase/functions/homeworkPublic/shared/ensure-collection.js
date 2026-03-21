'use strict';

const tcb = require('@cloudbase/node-sdk');

function normalizePrefix(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function createCollectionEnsurer(collectionName) {
  const adminDb = tcb.init({
    env: tcb.SYMBOL_CURRENT_ENV
  }).database();

  return async function ensureCollectionExists() {
    if (!adminDb || typeof adminDb.createCollection !== 'function') {
      return;
    }

    try {
      await adminDb.createCollection(collectionName);
    } catch (error) {
      const message = normalizePrefix(error && (error.errMsg || error.message)).toLowerCase();

      if (
        message.includes('database_collection_already_exist') ||
        message.includes('database collection already exist') ||
        message.includes('already exists') ||
        message.includes('collection exists') ||
        message.includes('duplicated')
      ) {
        return;
      }

      throw error;
    }
  };
}

module.exports = {
  createCollectionEnsurer
};
