const test = require('ava')
const lotion = require('../')

test('counter app with routes', async function(t) {
  const app = lotion({
    initialState: { counter: { count: 0 } },
    p2pPort: 20000,
    rpcPort: 20001,
    abciPort: 20002
  })

  app.use('counter', function(state, type) {
    state.count++
  })

  const { ports, genesisPath } = await app.start()

  const { state, send } = await lotion.connect(
    null,
    { genesis: require(genesisPath), nodes: [`ws://localhost:${ports.rpc}`] }
  )
  const result = await send({ type: 'counter' })
  await delay()
  const count = await state.counter.count
  t.is(count, 1)
})

function delay(ms = 1000) {
  return new Promise((resolve, reject) => {
    setTimeout(resolve, ms)
  })
}
