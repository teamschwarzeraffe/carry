import djson = require('deterministic-json')
import vstruct = require('varstruct')

const { createHash } = require('crypto')
const fs = require('fs-extra')
const { join } = require('path')
const createServer = require('abci')
const merk = require('merk')

export interface ABCIServer {
  listen(port)
}

export default function createABCIServer(
  state,
  stateMachine,
  initialState,
  lotionAppHome
): any {
  const stateFilePath = join(lotionAppHome, 'prev-state.json')

  const height = 0
  const abciServer = createServer({
    async info(request) {
      const stateExists = await fs.pathExists(stateFilePath)
      if (stateExists) {
        const stateFile
        try {
          const stateFileJSON = await fs.readFile(stateFilePath, 'utf8')
          stateFile = JSON.parse(stateFileJSON)
        } catch (err) {
          // TODO: warning log
          // error reading file, replay chain
          return {}
        }

        const rootHash = merk.hash(state)
        if (stateFile.rootHash !== rootHash) {
          // merk db and JSON file don't match, const's replay the chain
          // TODO: warning log since we probably want to know this is happening
          return {}
        }

        stateMachine.initialize(
          null,
          { validators: stateFile.validators || {} },
          true
        )
        height = stateFile.height
        return {
          lastBlockAppHash: rootHash,
          lastBlockHeight: stateFile.height
        }
      } else {
        return {}
      }
    },

    deliverTx(request) {
      try {
        const tx = decodeTx(request.tx)
        try {
          stateMachine.transition({ type: 'transaction', data: tx })
          return {}
        } catch (e) {
          return { code: 1, log: e.toString() }
        }
      } catch (e) {
        return { code: 1, log: 'Invalid transaction encoding' }
      }
    },
    checkTx(request) {
      try {
        const tx = decodeTx(request.tx)
        try {
          stateMachine.check(tx)
          return {}
        } catch (e) {
          return { code: 1, log: e.toString() }
        }
      } catch (e) {
        return { code: 1, log: 'Invalid transaction encoding' }
      }
    },
    beginBlock(request) {
      // ensure we don't have any changes since last commit
      merk.rollback(state)

      const time = request.header.time.seconds.toNumber()
      stateMachine.transition({ type: 'begin-block', data: { time } })
      return {}
    },
    endBlock() {
      stateMachine.transition({ type: 'block', data: {} })
      const { validators } = stateMachine.context()
      const validatorUpdates = []

      for (const pubKey in validators) {
        validatorUpdates.push({
          pubKey: { type: 'ed25519', data: Buffer.from(pubKey, 'base64') },
          power: { low: validators[pubKey], high: 0 }
        })
      }
      return {
        validatorUpdates
      }
    },
    async commit() {
      stateMachine.commit()
      height++

      const newStateFilePath = join(lotionAppHome, `state.json`)
      if (await fs.pathExists(newStateFilePath)) {
        await fs.move(newStateFilePath, stateFilePath, { overwrite: true })
      }

      // it's ok if merk commit and state file don't update atomically,
      // we will just fall back to replaying the chain next time we load
      await merk.commit(state)
      const rootHash = null
      try {
        // TODO: make this return null in merk instead of throwing
        rootHash = merk.hash(state)
      } catch (err) {
        // handle empty merk store, hash stays null
      }

      await fs.writeFile(
        newStateFilePath,
        JSON.stringify({
          height: height,
          rootHash: rootHash,
          validators: stateMachine.context().validators
        })
      )

      return { data: rootHash ? Buffer.from(rootHash, 'hex') : Buffer.alloc(0) }
    },
    async initChain(request) {
      /**
       * in next abci version, we'll get a timestamp here.
       * height is no longer tracked on info (we want to encourage isomorphic chain/channel code)
       */
      const initialInfo = buildInitialInfo(request)
      stateMachine.initialize(initialState, initialInfo)
      await merk.commit(state)
      return {}
    },
    async query(request) {
      // assert merk tree is not empty
      // TODO: change merk so we don't have to do this
      try {
        merk.hash(state)
      } catch (err) {
        return { value: Buffer.from('null'), height }
      }

      const path = request.path
      const proof = null
      const proofHeight = height
      proof = await merk.proof(state, path)
      const proofJSON = JSON.stringify(proof)
      const proofBytes = Buffer.from(proofJSON)
      return {
        value: proofBytes,
        height: proofHeight
      }
    }
  })

  return abciServer
}

function buildInitialInfo(initChainRequest) {
  const result = {
    validators: {}
  }
  initChainRequest.validators.forEach(validator => {
    result.validators[
      validator.pubKey.data.toString('base64')
    ] = validator.power.toNumber()
  })

  return result
}

const TxStruct = vstruct([
  { name: 'data', type: vstruct.VarString(vstruct.UInt32BE) },
  { name: 'nonce', type: vstruct.UInt32BE }
])

function decodeTx(txBuffer) {
  const decoded = TxStruct.decode(txBuffer)
  const tx = djson.parse(decoded.data)
  return tx
}
