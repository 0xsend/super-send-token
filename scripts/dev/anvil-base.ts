#!/usr/bin/env zx
import 'zx/globals'

$.verbose = true

// Required env
if (!$.env.ANVIL_BASE_FORK_URL) {
  console.error(chalk.red('ANVIL_BASE_FORK_URL is not set.'))
  process.exit(1)
}

// Defaults
$.env.ANVIL_BASE_BLOCK_TIME ||= '2'
$.env.ANVIL_BASE_EXTRA_ARGS ||= '--silent'
$.env.NEXT_PUBLIC_BASE_CHAIN_ID ||= '845337'
$.env.ANVIL_DOCKER_NETWORK ||= ''

const CONTAINER = 'sst-anvil-base'
const LOCAL_RPC_URL = 'http://127.0.0.1:8546'

console.log(chalk.blue('Running anvil base node'), {
  ANVIL_BASE_FORK_URL: $.env.ANVIL_BASE_FORK_URL,
  ANVIL_BASE_BLOCK_TIME: $.env.ANVIL_BASE_BLOCK_TIME,
  ANVIL_BASE_EXTRA_ARGS: $.env.ANVIL_BASE_EXTRA_ARGS,
  NEXT_PUBLIC_BASE_CHAIN_ID: $.env.NEXT_PUBLIC_BASE_CHAIN_ID,
  ANVIL_DOCKER_NETWORK: $.env.ANVIL_DOCKER_NETWORK || '(default)'
})

// Query base fee / gas price from the remote fork URL
const baseBaseFee = await $`cast base-fee --rpc-url ${$.env.ANVIL_BASE_FORK_URL}`.text()
const baseGasPrice = await $`cast gas-price --rpc-url ${$.env.ANVIL_BASE_FORK_URL}`.text()

// Do not fork from absolute latest block
const latest = await $`cast bn --rpc-url ${$.env.ANVIL_BASE_FORK_URL}`.text()
const blockHeight = (BigInt(latest.trim()) - 30n).toString()

await $`docker rm -f ${CONTAINER}`.quiet().catch(() => {})

const networkArgs = $.env.ANVIL_DOCKER_NETWORK ? ["--network", $.env.ANVIL_DOCKER_NETWORK] : []

// Start docker container in the background
await $`docker run --rm -d --platform=linux/amd64 ${networkArgs} -p=0.0.0.0:8546:8546 --name=${CONTAINER} ghcr.io/foundry-rs/foundry:stable "anvil \
  --host=0.0.0.0 \
  --port=8546 \
  --chain-id=${$.env.NEXT_PUBLIC_BASE_CHAIN_ID} \
  --fork-url=${$.env.ANVIL_BASE_FORK_URL} \
  --block-time=${$.env.ANVIL_BASE_BLOCK_TIME} \
  --base-fee=${baseBaseFee.trim()} \
  --gas-price=${baseGasPrice.trim()} \
  --fork-block-number=${blockHeight} \
  ${$.env.ANVIL_BASE_EXTRA_ARGS}"`

// Wait for the RPC node to be ready by polling it
console.log(chalk.yellow('Waiting for RPC node to be ready...'))
let retries = 0
const maxRetries = 30
while (retries < maxRetries) {
  try {
    await $`cast bn --rpc-url ${LOCAL_RPC_URL}`.quiet()
    console.log(chalk.green('RPC node is ready!'))
    break
  } catch (error) {
    retries++
    if (retries === maxRetries) {
      console.error(chalk.red('RPC node failed to start after 30 attempts'))
      process.exit(1)
    }
    await sleep(1000)
  }
}

console.log(chalk.yellow('Prefetching remote state to avoid long initial RPC delays...'))

// Important contracts (addresses for Base mainnet fork)
const IMPORTANT_CONTRACTS = [
  // Superfluid core
  { address: '0x6a214c324553F96F04eFBDd66908685525Da0E0d', name: 'Resolver' },
  { address: '0x4C073B3baB6d8826b8C5b229f3cfdC1eC6E47E74', name: 'Host' },
  { address: '0x19ba78B9cDB05A877718841c574325fdB53601bb', name: 'CFAv1' },
  { address: '0xe20B9a38E0c96F61d1bA6b42a61512D56Fea1Eb3', name: 'SuperTokenFactory' },
  // Tokens
  { address: '0xEab49138BA2Ea6dd776220fE26b7b8E446638956', name: 'SEND Token' },
  { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', name: 'USDC' },
]

// Prefetch code and basic calls for each contract
const prefetchPromises: Promise<unknown>[] = []

for (const c of IMPORTANT_CONTRACTS) {
  console.log(`Prefetching ${c.name} (${c.address})...`)
  // Prefetch contract code
  prefetchPromises.push($`cast code ${c.address} --rpc-url ${LOCAL_RPC_URL}`.quiet())

  // For tokens, prefetch metadata
  if (c.name.includes('Token') || c.name === 'USDC') {
    prefetchPromises.push($`cast call ${c.address} "name()(string)" --rpc-url ${LOCAL_RPC_URL}`.quiet())
    prefetchPromises.push($`cast call ${c.address} "symbol()(string)" --rpc-url ${LOCAL_RPC_URL}`.quiet())
    prefetchPromises.push($`cast call ${c.address} "decimals()(uint8)" --rpc-url ${LOCAL_RPC_URL}`.quiet())
    prefetchPromises.push($`cast call ${c.address} "totalSupply()(uint256)" --rpc-url ${LOCAL_RPC_URL}`.quiet())
  }
}

// Prefetch some common storage slots
console.log('Prefetching common storage slots...')
const storageSlots = ['0x0', '0x1', '0x2', '0x3', '0x4']
for (const slot of storageSlots) {
  for (const c of IMPORTANT_CONTRACTS) {
    prefetchPromises.push($`cast storage ${c.address} ${slot} --rpc-url ${LOCAL_RPC_URL}`.quiet())
  }
}

await Promise.all(prefetchPromises).catch(() => {
  console.warn(chalk.yellow('Some prefetch operations failed, continuing...'))
})

console.log(chalk.green('Remote state prefetching complete!'))
console.log(chalk.blue('Attaching to container logs...'))
await $`docker logs -f ${CONTAINER}`

