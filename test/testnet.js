const test = require('ava')
const getPort = require('get-port')
const lotion = require('../')
const { RpcClient } = require('tendermint')

function startApp({
  genesisPath,
  rpcPort,
  peers,
  p2pPort,
  logTendermint = false
}) {
  const app = lotion({
    initialState: {
      txCount: 0,
      blockCount: 0,
      word: ''
    },
    rpcPort,
    p2pPort,
    genesisPath,
    peers,
    logTendermint
  })

  app.use(function(state, tx, info) {
    state.txCount++
    if (tx.letter) {
      state.word += tx.letter
    }

    if (tx.pubKey) {
      info.validators[tx.pubKey] = 10
    }
  })

  app.useBlock(function(state, info) {
    state.blockCount++
  })

  return app.start()
}

test('counter app testnet', async function(t) {
  const nodeA = {
    rpcPort: await getPort(),
    p2pPort: await getPort()
  }
  const nodeB = {
    rpcPort: await getPort(),
    p2pPort: await getPort()
  }

  const a = await startApp(nodeA)
  const aRpc = RpcClient(`localhost:${nodeA.rpcPort}`)
  const status = await aRpc.status()

  const b = await startApp({
    ...nodeB,
    genesisPath: a.genesisPath,
    peers: [`${status.node_info.id}@localhost:${nodeA.p2pPort}`]
  })
  const bRpc = RpcClient(`localhost:${nodeB.rpcPort}`)

  status = await bRpc.status()
  const bPubKey = status.validator_info.pub_key.value
  t.true(status.sync_info.latest_block_height >= 1)

  const alc = await lotion.connect(
    null,
    {
      genesis: require(a.genesisPath),
      nodes: [`ws://localhost:${nodeA.rpcPort}`]
    }
  )
  const blc = await lotion.connect(
    null,
    {
      genesis: require(a.genesisPath),
      nodes: [`ws://localhost:${nodeB.rpcPort}`]
    }
  )

  await blc.send({ pubKey: bPubKey })

  const txCount = await alc.state.txCount
  t.is(txCount, 1)

  await Promise.all([alc.send({ letter: 'a' }), blc.send({ letter: 'b' })])
  t.is(await alc.state.txCount, 3)
  t.true((await alc.state.blockCount) > 0)

  t.is(await alc.state.word, await blc.state.word)
})

function delay(ms = 1000) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}
