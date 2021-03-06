// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
const hre = require('hardhat')
const { toFixedHex, poseidonHash2 } = require('../src/utils')
const MerkleTree = require('fixed-merkle-tree')
const abi = new hre.ethers.utils.AbiCoder()
const instances = [
  '0x1111000000000000000000000000000000001111',
  '0x2222000000000000000000000000000000002222',
  '0x3333000000000000000000000000000000003333',
  '0x4444000000000000000000000000000000004444',
]

const blocks = ['0xaaaaaaaa', '0xbbbbbbbb', '0xcccccccc', '0xdddddddd']
const CHUNK_TREE_HEIGHT = 8
const levels = 20

const nonRandomBN = (nonce = 0) =>
  hre.ethers.BigNumber.from('0x004d51bffaafdb3eed0661c1cfd76c8cd6ec1456b80b24bbb855f3a141ebf0be').sub(nonce)

async function main() {
  const governance = '0x5efda50f22d34F262c29268506C5Fa42cB56A1Ce'
  const [demixProxy] = await hre.ethers.getSigners()
  console.log('deployer/demixProxy acc: ', demixProxy.address)

  const tree = new MerkleTree(levels, [], { hashFunction: poseidonHash2 })
  const DeMixTreesV1Mock = await hre.ethers.getContractFactory('DeMixTreesV1Mock')
  const demixTreesV1Mock = await DeMixTreesV1Mock.deploy(0, 0, tree.root(), tree.root())
  await demixTreesV1Mock.deployed()
  console.log('demixTreesV1Mock deployed to:', demixTreesV1Mock.address)

  const notes = []
  const depositEvents = {}
  const withdrawalEvents = {}
  for (let i = 0; i < 2 ** CHUNK_TREE_HEIGHT; i++) {
    const note = {
      instance: instances[i % instances.length],
      depositBlock: blocks[i % blocks.length],
      withdrawalBlock: 2 + i + i * 4 * 60 * 24,
      commitment: nonRandomBN(i),
      nullifierHash: nonRandomBN(i + instances.length),
    }

    await demixTreesV1Mock.register(
      note.instance,
      toFixedHex(note.commitment),
      toFixedHex(note.nullifierHash),
      note.depositBlock,
      note.withdrawalBlock,
      { gasLimit: 200000 },
    )
    const encodedData = abi.encode(
      ['address', 'bytes32', 'uint256'],
      [note.instance, toFixedHex(note.commitment), note.depositBlock],
    )
    const leaf = hre.ethers.utils.keccak256(encodedData)
    depositEvents[leaf] = {
      hash: toFixedHex(note.commitment),
      instance: toFixedHex(note.instance, 20),
      block: toFixedHex(note.depositBlock, 4),
    }
    const encodedDataW = abi.encode(
      ['address', 'bytes32', 'uint256'],
      [note.instance, toFixedHex(note.nullifierHash), note.withdrawalBlock],
    )
    const leafW = hre.ethers.utils.keccak256(encodedDataW)
    withdrawalEvents[leafW] = {
      hash: toFixedHex(note.nullifierHash),
      instance: toFixedHex(note.instance, 20),
      block: toFixedHex(note.withdrawalBlock, 4),
    }
    notes[i] = note
  }
  console.log(`Registered ${notes.length} new deposits and withdrawals in demixTreesV1Mock`)
  console.log(JSON.stringify(depositEvents, null, 2))
  console.log(JSON.stringify(withdrawalEvents, null, 2))

  const BatchTreeUpdateVerifier = await hre.ethers.getContractFactory('BatchTreeUpdateVerifier')
  const verifier = await BatchTreeUpdateVerifier.deploy()
  await verifier.deployed()
  console.log('Verifier deployed to:', verifier.address)

  const DeMixTrees = await hre.ethers.getContractFactory('DeMixTrees')
  const demixTrees = await DeMixTrees.deploy(
    governance,
    demixProxy.address,
    demixTreesV1Mock.address,
    verifier.address,
    {
      unprocessedDeposits: 1, // this approximate value, actually there are 4, but the contract will figure out that
      unprocessedWithdrawals: 1,
      depositsPerDay: 2, // parameter for searching the count of unprocessedDeposits
      withdrawalsPerDay: 2,
    },
  )
  await demixTrees.deployed()
  console.log('demixTrees deployed to:', demixTrees.address)
  console.log('You can use the same private key to register new deposits in the demixTrees')

  console.log(`\nDEMIX_TREES_V1=${demixTreesV1Mock.address}`)
  console.log(`DEMIX_TREES=${demixTrees.address}`)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
