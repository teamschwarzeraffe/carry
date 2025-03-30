const { connect } = require('../src/index')

async function main() {
  const { state, send } = await connect(process.env.GCI)

  console.log(await send({ foo: 'bar', shouldError: false }))

  console.log(await state)
}

main()
