import { Resolvable, Resolver } from 'did-resolver'
import { Contract, ContractFactory, getBytes, SigningKey } from 'ethers'
import { EthereumDIDRegistry, getResolver } from 'ethr-did-resolver'
import { DelegateTypes, EthrDID, KeyPair } from '../index'
import { createProvider, sleep } from './util/testUtils'
import { verifyJWT } from 'did-jwt'

import { jest } from '@jest/globals'

jest.setTimeout(30000)

describe('EthrDID', () => {
  let ethrDid: EthrDID,
    plainDid: EthrDID,
    registry: string,
    accounts: string[],
    did: string,
    identity: string,
    owner: string,
    delegate1: string,
    delegate2: string,
    resolver: Resolvable

  const provider = createProvider()

  beforeAll(async () => {
    const factory = ContractFactory.fromSolidity(EthereumDIDRegistry).connect(await provider.getSigner(0))

    let registryContract: Contract
    registryContract = await factory.deploy()
    registryContract = await registryContract.waitForDeployment()

    registry = await registryContract.getAddress()

    const accountSigners = await provider.listAccounts()
    accounts = accountSigners.map((signer) => signer.address)

    identity = accounts[1]
    owner = accounts[2]
    delegate1 = accounts[3]
    delegate2 = accounts[4]
    did = `did:ethr:dev:${identity}`

    resolver = new Resolver(getResolver({ name: 'dev', provider, registry, chainId: 1337 }))
    ethrDid = new EthrDID({
      provider,
      registry,
      identifier: identity,
      chainNameOrId: 'dev',
    })
  })

  describe('presets', () => {
    it('sets address', () => {
      expect(ethrDid.address).toEqual(identity)
    })

    it('sets did', () => {
      expect(ethrDid.did).toEqual(did)
    })
  })

  it('defaults owner to itself', () => {
    return expect(ethrDid.lookupOwner()).resolves.toEqual(identity)
  })

  describe('key management', () => {
    describe('owner changed', () => {
      beforeAll(async () => {
        await ethrDid.changeOwner(owner)
      })

      it('changes owner', () => {
        return expect(ethrDid.lookupOwner()).resolves.toEqual(owner)
      })

      it('resolves document', async () => {
        return expect((await resolver.resolve(did)).didDocument).toEqual({
          '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
          id: did,
          verificationMethod: [
            {
              id: `${did}#controller`,
              type: 'EcdsaSecp256k1RecoveryMethod2020',
              controller: did,
              blockchainAccountId: `eip155:1337:${owner}`,
            },
          ],
          authentication: [`${did}#controller`],
          assertionMethod: [`${did}#controller`],
        })
      })
    })

    describe('delegates', () => {
      describe('add signing delegate', () => {
        beforeAll(async () => {
          const txHash = await ethrDid.addDelegate(delegate1, {
            expiresIn: 86400,
          })
          await provider.waitForTransaction(txHash)
        })

        it('resolves document', async () => {
          const resolution = await resolver.resolve(did)
          return expect(resolution.didDocument).toEqual({
            '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
            id: did,
            verificationMethod: [
              {
                id: `${did}#controller`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${owner}`,
              },
              {
                id: `${did}#delegate-1`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate1}`,
              },
            ],
            authentication: [`${did}#controller`],
            assertionMethod: [`${did}#controller`, `${did}#delegate-1`],
          })
        })
      })

      describe('add auth delegate', () => {
        beforeAll(async () => {
          const txHash = await ethrDid.addDelegate(delegate2, {
            delegateType: DelegateTypes.sigAuth,
            expiresIn: 5,
          })
          await provider.waitForTransaction(txHash)
        })

        it('resolves document', async () => {
          return expect((await resolver.resolve(did)).didDocument).toEqual({
            '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
            id: did,
            verificationMethod: [
              {
                id: `${did}#controller`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${owner}`,
              },
              {
                id: `${did}#delegate-1`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate1}`,
              },
              {
                id: `${did}#delegate-2`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate2}`,
              },
            ],
            authentication: [`${did}#controller`, `${did}#delegate-2`],
            assertionMethod: [`${did}#controller`, `${did}#delegate-1`, `${did}#delegate-2`],
          })
        })
      })

      describe('expire automatically', () => {
        beforeAll(async () => {
          await sleep(5)
        })

        it('resolves document', async () => {
          const resolution = await resolver.resolve(did)
          return expect(resolution.didDocument).toEqual({
            '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
            id: did,
            verificationMethod: [
              {
                id: `${did}#controller`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${owner}`,
              },
              {
                id: `${did}#delegate-1`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate1}`,
              },
            ],
            authentication: [`${did}#controller`],
            assertionMethod: [`${did}#controller`, `${did}#delegate-1`],
          })
        })
      })

      describe('re-add auth delegate', () => {
        beforeAll(async () => {
          const txHash = await ethrDid.addDelegate(delegate2, {
            delegateType: DelegateTypes.sigAuth,
          })
          await provider.waitForTransaction(txHash)
        })

        it('resolves document', async () => {
          return expect((await resolver.resolve(did)).didDocument).toEqual({
            '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
            id: did,
            verificationMethod: [
              {
                id: `${did}#controller`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${owner}`,
              },
              {
                id: `${did}#delegate-1`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate1}`,
              },
              {
                id: `${did}#delegate-3`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate2}`,
              },
            ],
            authentication: [`${did}#controller`, `${did}#delegate-3`],
            assertionMethod: [`${did}#controller`, `${did}#delegate-1`, `${did}#delegate-3`],
          })
        })
      })

      describe('revokes delegate', () => {
        it('resolves document', async () => {
          const txHash = await ethrDid.revokeDelegate(delegate2, DelegateTypes.sigAuth)
          await provider.waitForTransaction(txHash)
          await sleep(2) // this smells but for some reason ganache is not updating :(

          const resolution = await resolver.resolve(did)
          return expect(resolution.didDocument).toEqual({
            '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
            id: did,
            verificationMethod: [
              {
                id: `${did}#controller`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${owner}`,
              },
              {
                id: `${did}#delegate-1`,
                type: 'EcdsaSecp256k1RecoveryMethod2020',
                controller: did,
                blockchainAccountId: `eip155:1337:${delegate1}`,
              },
            ],
            authentication: [`${did}#controller`],
            assertionMethod: [`${did}#controller`, `${did}#delegate-1`],
          })
        })
      })
    })

    describe('attributes', () => {
      describe('publicKey', () => {
        describe('Secp256k1VerificationKey2018', () => {
          beforeAll(async () => {
            const txHash = await ethrDid.setAttribute(
              'did/pub/Secp256k1/veriKey',
              '0x02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
              86400
            )
            await provider.waitForTransaction(txHash)
          })

          it('resolves document', async () => {
            return expect((await resolver.resolve(did)).didDocument).toEqual({
              '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
              ],
              id: did,
              verificationMethod: [
                {
                  id: `${did}#controller`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${owner}`,
                },
                {
                  id: `${did}#delegate-1`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${delegate1}`,
                },
                {
                  id: `${did}#delegate-5`,
                  type: 'EcdsaSecp256k1VerificationKey2019',
                  controller: did,
                  publicKeyHex: '02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
                },
              ],
              authentication: [`${did}#controller`],
              assertionMethod: [`${did}#controller`, `${did}#delegate-1`, `${did}#delegate-5`],
            })
          })
        })

        describe('Base64 Encoded Key', () => {
          beforeAll(async () => {
            const txHash = await ethrDid.setAttribute(
              'did/pub/Ed25519/veriKey/base64',
              'Arl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2tx',
              86400
            )
            await provider.waitForTransaction(txHash)
          })

          it('resolves document', async () => {
            return expect((await resolver.resolve(did)).didDocument).toEqual({
              '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
              ],
              id: did,
              verificationMethod: [
                {
                  id: `${did}#controller`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${owner}`,
                },
                {
                  id: `${did}#delegate-1`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${delegate1}`,
                },
                {
                  id: `${did}#delegate-5`,
                  type: 'EcdsaSecp256k1VerificationKey2019',
                  controller: did,
                  publicKeyHex: '02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
                },
                {
                  id: `${did}#delegate-6`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: 'Arl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2tx',
                },
              ],
              authentication: [`${did}#controller`],
              assertionMethod: [`${did}#controller`, `${did}#delegate-1`, `${did}#delegate-5`, `${did}#delegate-6`],
            })
          })
        })

        describe('Use Buffer', () => {
          beforeAll(async () => {
            const txHash = await ethrDid.setAttribute(
              'did/pub/Ed25519/veriKey/base64',
              Buffer.from('f2b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b72', 'hex'),
              86400
            )
            await provider.waitForTransaction(txHash)
          })

          it('resolves document', async () => {
            return expect((await resolver.resolve(did)).didDocument).toEqual({
              '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
              ],
              id: did,
              verificationMethod: [
                {
                  id: `${did}#controller`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${owner}`,
                },
                {
                  id: `${did}#delegate-1`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${delegate1}`,
                },
                {
                  id: `${did}#delegate-5`,
                  type: 'EcdsaSecp256k1VerificationKey2019',
                  controller: did,
                  publicKeyHex: '02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
                },
                {
                  id: `${did}#delegate-6`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: 'Arl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2tx',
                },
                {
                  id: `${did}#delegate-7`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: '8rl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2ty',
                },
              ],
              authentication: [`${did}#controller`],
              assertionMethod: [
                `${did}#controller`,
                `${did}#delegate-1`,
                `${did}#delegate-5`,
                `${did}#delegate-6`,
                `${did}#delegate-7`,
              ],
            })
          })
        })
      })

      describe('service endpoints', () => {
        describe('HubService', () => {
          beforeAll(async () => {
            const txHash = await ethrDid.setAttribute('did/svc/HubService', 'https://hubs.uport.me', 86400)
            await provider.waitForTransaction(txHash)
          })
          it('resolves document', async () => {
            return expect((await resolver.resolve(did)).didDocument).toEqual({
              '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
              ],
              id: did,
              verificationMethod: [
                {
                  id: `${did}#controller`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${owner}`,
                },
                {
                  id: `${did}#delegate-1`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${delegate1}`,
                },
                {
                  id: `${did}#delegate-5`,
                  type: 'EcdsaSecp256k1VerificationKey2019',
                  controller: did,
                  publicKeyHex: '02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
                },
                {
                  id: `${did}#delegate-6`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: 'Arl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2tx',
                },
                {
                  id: `${did}#delegate-7`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: '8rl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2ty',
                },
              ],
              authentication: [`${did}#controller`],
              assertionMethod: [
                `${did}#controller`,
                `${did}#delegate-1`,
                `${did}#delegate-5`,
                `${did}#delegate-6`,
                `${did}#delegate-7`,
              ],
              service: [
                {
                  id: 'did:ethr:dev:0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf#service-1',
                  type: 'HubService',
                  serviceEndpoint: 'https://hubs.uport.me',
                },
              ],
            })
          })
        })

        describe('revoke HubService', () => {
          beforeAll(async () => {
            const txHash = await ethrDid.revokeAttribute('did/svc/HubService', 'https://hubs.uport.me')
            await provider.waitForTransaction(txHash)
          })
          it('resolves document', async () => {
            return expect((await resolver.resolve(did)).didDocument).toEqual({
              '@context': [
                'https://www.w3.org/ns/did/v1',
                'https://w3id.org/security/suites/secp256k1recovery-2020/v2',
              ],
              id: did,
              verificationMethod: [
                {
                  id: `${did}#controller`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${owner}`,
                },
                {
                  id: `${did}#delegate-1`,
                  type: 'EcdsaSecp256k1RecoveryMethod2020',
                  controller: did,
                  blockchainAccountId: `eip155:1337:${delegate1}`,
                },
                {
                  id: `${did}#delegate-5`,
                  type: 'EcdsaSecp256k1VerificationKey2019',
                  controller: did,
                  publicKeyHex: '02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
                },
                {
                  id: `${did}#delegate-6`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: 'Arl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2tx',
                },
                {
                  id: `${did}#delegate-7`,
                  type: 'Ed25519VerificationKey2018',
                  controller: did,
                  publicKeyBase64: '8rl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2ty',
                },
              ],
              authentication: [`${did}#controller`],
              assertionMethod: [
                `${did}#controller`,
                `${did}#delegate-1`,
                `${did}#delegate-5`,
                `${did}#delegate-6`,
                `${did}#delegate-7`,
              ],
            })
          })
        })
      })
    })
  })

  describe('signJWT', () => {
    describe('No signer configured', () => {
      it('should fail', () => {
        return expect(ethrDid.signJWT({ hello: 'world' })).rejects.toEqual(new Error('No signer configured'))
      })
    })

    describe('creating a signing Delegate', () => {
      let kp: KeyPair
      beforeAll(async () => {
        kp = (await ethrDid.createSigningDelegate()).kp
      })

      it('resolves document', async () => {
        return expect((await resolver.resolve(did)).didDocument).toEqual({
          '@context': ['https://www.w3.org/ns/did/v1', 'https://w3id.org/security/suites/secp256k1recovery-2020/v2'],
          id: did,
          verificationMethod: [
            {
              id: `${did}#controller`,
              type: 'EcdsaSecp256k1RecoveryMethod2020',
              controller: did,
              blockchainAccountId: `eip155:1337:${owner}`,
            },
            {
              id: `${did}#delegate-1`,
              type: 'EcdsaSecp256k1RecoveryMethod2020',
              controller: did,
              blockchainAccountId: `eip155:1337:${delegate1}`,
            },
            {
              id: `${did}#delegate-5`,
              type: 'EcdsaSecp256k1VerificationKey2019',
              controller: did,
              publicKeyHex: '02b97c30de767f084ce3080168ee293053ba33b235d7116a3263d29f1450936b71',
            },
            {
              id: `${did}#delegate-6`,
              type: 'Ed25519VerificationKey2018',
              controller: did,
              publicKeyBase64: 'Arl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2tx',
            },
            {
              id: `${did}#delegate-7`,
              type: 'Ed25519VerificationKey2018',
              controller: did,
              publicKeyBase64: '8rl8MN52fwhM4wgBaO4pMFO6M7I11xFqMmPSnxRQk2ty',
            },
            {
              id: `${did}#delegate-8`,
              type: 'EcdsaSecp256k1RecoveryMethod2020',
              controller: did,
              blockchainAccountId: `eip155:1337:${kp.address}`,
            },
          ],
          authentication: [`${did}#controller`],
          assertionMethod: [
            `${did}#controller`,
            `${did}#delegate-1`,
            `${did}#delegate-5`,
            `${did}#delegate-6`,
            `${did}#delegate-7`,
            `${did}#delegate-8`,
          ],
        })
      })

      it('should sign valid jwt', async () => {
        expect.assertions(1)
        const jwt = await ethrDid.signJWT({ hello: 'world' })
        const verification = await verifyJWT(jwt, { resolver })
        const { signer } = verification
        expect(signer).toEqual({
          id: `${did}#delegate-8`,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
          controller: did,
          blockchainAccountId: `eip155:1337:${kp.address}`,
        })
      })
    })

    describe('plain vanilla key pair account', () => {
      it('should sign valid jwt', async () => {
        const kp: KeyPair = EthrDID.createKeyPair('dev')
        plainDid = new EthrDID({
          ...kp,
          provider,
          registry: registry,
        })
        const jwt = await plainDid.signJWT({ hello: 'world' })
        const { payload } = await verifyJWT(jwt, { resolver })
        expect(payload).toBeDefined()
      })
    })
  })

  describe('verifyJWT', () => {
    const ethrDidAsIssuer = new EthrDID(EthrDID.createKeyPair('dev'))
    const did = ethrDidAsIssuer.did

    it('verifies the signature of the JWT', async () => {
      expect.assertions(1)
      return ethrDidAsIssuer
        .signJWT({ hello: 'friend' })
        .then((jwt) => plainDid.verifyJWT(jwt, resolver))
        .then(({ issuer }) => expect(issuer).toEqual(did))
    })

    describe('uses did for verifying aud claim', () => {
      it('verifies the signature of the JWT', () => {
        expect.assertions(1)
        return ethrDidAsIssuer
          .signJWT({ hello: 'friend', aud: plainDid.did })
          .then((jwt) => plainDid.verifyJWT(jwt, resolver))
          .then(({ issuer }) => expect(issuer).toEqual(did))
      })

      it('fails if wrong did is used as audience', async () => {
        expect.assertions(1)
        const signed = await ethrDidAsIssuer.signJWT({ hello: 'friend', aud: 'some random audience' })
        try {
          await plainDid.verifyJWT(signed, resolver)
        } catch (e) {
          expect(e).toEqual(Error(`invalid_config: JWT audience does not match your DID or callback url`))
        }
      })
    })
  })

  describe('Large key', () => {
    const rsa4096PublicKey = `-----BEGIN PUBLIC KEY-----
            MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAolN9csarxOP++9pbjLE/
            /ybicmTGL0+or6LmLkos9YEXOb8w1RaoQoLuPNbCqfHlnbiPdvl9zdVHCswf9DwK
            Ba6ecs0Vr3OW3FTSyejHiqinkfmEgRKOoAf7S8nQcsiDzANPondL+1z+dgmo8nTK
            9806ei8LYzKzLjpi+SmdtTVvUQZGuxAT1GuzzT5jyE+MyR2zwSaCTyNC6zwnk51i
            z+zf8WRNe32WtBLhNbz6MKlwup1CSear9oeZQJRQspkud7b84Clv6QeOCPqMuRLy
            ibM8J+BC5cRyxVyV2rHshvD134cbR6uEIsggoC9NvvZcaJlcG25gA7rUrIJ8CGEG
            9WZsmqUfrykOJ3HFqGyJZlpVq0hHM6ikcexdbqPFcwj9Vcx3yecb6WABZCeYVHDw
            3AoGu/Y/m2xJ7L3iPCWcpB94y0e7Yp3M6S8Y4RpL2iEykCXd7CVYVV1QVPz4/5D8
            mT4S4PG0I0/yBbblUz9CcYSJ/9eFOekSRY7TAEEJcrBY7MkXZcNRwcFtgi9PWpaC
            XTsIYri2eBKqAgFT9xaPiFCFYJlpfUe81pgp+5mZsObYlB0AKJb7o0rRa5XLO4JL
            ZiovTaqHZW9gvO3KZyJNYx7XM9Vjwm4FB5NUxSvqHJyUgGC6H7jwK2wKtrThrjkt
            P9+7B63q+4nzilC9UUHEIosCAwEAAQ==
            -----END PUBLIC KEY-----`

    beforeAll(async () => {
      const txHash = await ethrDid.setAttribute('did/pub/Rsa/veriKey/pem', rsa4096PublicKey, 86400, 200000)
      await provider.waitForTransaction(txHash)
    })

    it('should create add the large RSA key in the hex format', async () => {
      const didDocument = (await resolver.resolve(did)).didDocument
      const pk = didDocument?.verificationMethod?.find((pk) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return typeof (<any>pk).publicKeyPem !== 'undefined'
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((<any>pk).publicKeyPem).toEqual(rsa4096PublicKey)
    })
  })

  describe('base58 key', () => {
    const publicKeyBase58 = 'SYnSwQmBmVwrHoGo6mnqFCX28sr3UzAZw9yyiBTLaf2foDfxDTgNdpn3MPD4gUGi4cgunK8cnGbPS5yjVh5uAXGr'

    it('supports base58 keys as hexstring', async () => {
      const publicKeyHex =
        '04fdd57adec3d438ea237fe46b33ee1e016eda6b585c3e27ea66686c2ea535847946393f8145252eea68afe67e287b3ed9b31685ba6c3b00060a73b9b1242d68f7'
      const did = `did:ethr:dev:${delegate1}`
      const didController = new EthrDID({
        identifier: did,
        provider,
        registry,
      })
      const txHash = await didController.setAttribute('did/pub/Secp256k1/veriKey/base58', `0x${publicKeyHex}`, 86400)
      await provider.waitForTransaction(txHash)
      const doc = (await resolver.resolve(did)).didDocument
      expect(doc?.verificationMethod).toEqual([
        {
          blockchainAccountId: `eip155:1337:${delegate1}`,
          controller: did,
          id: `${did}#controller`,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
        },
        {
          controller: did,
          id: `${did}#delegate-1`,
          publicKeyBase58,
          type: 'EcdsaSecp256k1VerificationKey2019',
        },
      ])
    })

    it('supports base58 keys as string', async () => {
      const did = `did:ethr:dev:${delegate2}`
      const didController = new EthrDID({
        identifier: did,
        provider,
        registry,
      })
      const txHash = await didController.setAttribute('did/pub/Secp256k1/veriKey/base58', publicKeyBase58, 86400)
      await provider.waitForTransaction(txHash)
      const doc = (await resolver.resolve(did)).didDocument
      expect(doc?.verificationMethod).toEqual([
        {
          blockchainAccountId: `eip155:1337:${delegate2}`,
          controller: did,
          id: `${did}#controller`,
          type: 'EcdsaSecp256k1RecoveryMethod2020',
        },
        {
          controller: did,
          id: `${did}#delegate-1`,
          publicKeyBase58,
          type: 'EcdsaSecp256k1VerificationKey2019',
        },
      ])
    })
  })
})

describe('EthrDID (Meta Transactions)', () => {
  let ethrDid: EthrDID,
    walletSigner: EthrDID,
    registry: string,
    registryContract: Contract,
    accounts: string[],
    did: string,
    identity: string,
    delegate1: string,
    delegate2: string,
    walletIdentity: string,
    resolver: Resolvable

  const provider = createProvider()

  beforeAll(async () => {
    const factory = ContractFactory.fromSolidity(EthereumDIDRegistry).connect(await provider.getSigner(0))

    registryContract = await factory.deploy()
    registryContract = await registryContract.waitForDeployment()

    registry = await registryContract.getAddress()

    const accountSigners = await provider.listAccounts()
    accounts = accountSigners.map((signer) => signer.address)

    identity = accounts[1]
    delegate1 = accounts[3]
    delegate2 = accounts[4]
    walletIdentity = accounts[5]
    did = `did:ethr:dev:${identity}`

    resolver = new Resolver(getResolver({ name: 'dev', provider, registry, chainId: 1337 }))
    ethrDid = new EthrDID({
      provider,
      registry,
      identifier: identity,
      chainNameOrId: 'dev',
    })
    walletSigner = new EthrDID({
      provider,
      registry,
      identifier: identity,
      txSigner: await provider.getSigner(walletIdentity),
      chainNameOrId: 'dev',
    })
  })

  const currentOwnerPrivateKey = getBytes('0x0000000000000000000000000000000000000000000000000000000000000001')

  it('add delegates via meta transaction', async () => {
    // Add first delegate
    const delegateType = DelegateTypes.sigAuth
    const exp = 86400
    const hash1 = await ethrDid.createAddDelegateHash(delegateType, delegate1, exp)
    const signature1 = new SigningKey(currentOwnerPrivateKey).sign(hash1)

    await walletSigner.addDelegateSigned(
      delegate1,
      {
        sigV: signature1.v,
        sigR: signature1.r,
        sigS: signature1.s,
      },
      { delegateType: DelegateTypes.sigAuth, expiresIn: exp }
    )

    let resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${identity}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-1`,
          blockchainAccountId: `eip155:1337:${delegate1}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-1`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-1`],
    })

    // Add second delegate
    const hash2 = await ethrDid.createAddDelegateHash(delegateType, delegate2, exp)
    const signature2 = new SigningKey(currentOwnerPrivateKey).sign(hash2)

    await walletSigner.addDelegateSigned(
      delegate2,
      {
        sigV: signature2.v,
        sigR: signature2.r,
        sigS: signature2.s,
      },
      { delegateType: DelegateTypes.sigAuth, expiresIn: exp }
    )

    resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${identity}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-1`,
          blockchainAccountId: `eip155:1337:${delegate1}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-2`,
          blockchainAccountId: `eip155:1337:${delegate2}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-1`, `${did}#delegate-2`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-1`, `${did}#delegate-2`],
    })
  })

  it('remove delegate1 via meta transaction', async () => {
    const delegateType = DelegateTypes.sigAuth
    const hash = await ethrDid.createRevokeDelegateHash(delegateType, delegate1)
    const signature = new SigningKey(currentOwnerPrivateKey).sign(hash)

    await walletSigner.revokeDelegateSigned(delegate1, DelegateTypes.sigAuth, {
      sigV: signature.v,
      sigR: signature.r,
      sigS: signature.s,
    })

    // revoking a delegate sets their validity to the block timestamp instead of 0, so we need to wait at least a
    // second for the resolver to see a difference in the document
    await sleep(1)

    const resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${identity}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-2`,
          blockchainAccountId: `eip155:1337:${delegate2}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-2`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-2`],
    })
  })

  it('add attributes via meta transaction', async () => {
    // Add first attribute
    const attributeName = 'did/svc/testService'
    const serviceEndpointParams = { uri: 'https://didcomm.example.com', transportType: 'http' }
    const attributeValue = JSON.stringify(serviceEndpointParams)
    const attributeExpiration = 86400
    const hash1 = await ethrDid.createSetAttributeHash(attributeName, attributeValue, attributeExpiration)
    const signature1 = new SigningKey(currentOwnerPrivateKey).sign(hash1)

    await walletSigner.setAttributeSigned(attributeName, attributeValue, attributeExpiration, {
      sigV: signature1.v,
      sigR: signature1.r,
      sigS: signature1.s,
    })

    let resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${identity}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-2`,
          blockchainAccountId: `eip155:1337:${delegate2}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-2`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-2`],
      service: [
        {
          id: `${did}#service-1`,
          serviceEndpoint: {
            transportType: 'http',
            uri: 'https://didcomm.example.com',
          },
          type: 'testService',
        },
      ],
    })

    // Add second attribute
    const attributeName2 = 'did/svc/test2Service'
    const hash2 = await ethrDid.createSetAttributeHash(attributeName2, attributeValue, attributeExpiration)
    const signature2 = new SigningKey(currentOwnerPrivateKey).sign(hash2)

    await walletSigner.setAttributeSigned(attributeName2, attributeValue, attributeExpiration, {
      sigV: signature2.v,
      sigR: signature2.r,
      sigS: signature2.s,
    })

    resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${identity}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-2`,
          blockchainAccountId: `eip155:1337:${delegate2}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-2`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-2`],
      service: [
        {
          id: `${did}#service-1`,
          serviceEndpoint: {
            transportType: 'http',
            uri: 'https://didcomm.example.com',
          },
          type: 'testService',
        },
        {
          id: `${did}#service-2`,
          serviceEndpoint: {
            transportType: 'http',
            uri: 'https://didcomm.example.com',
          },
          type: 'test2Service',
        },
      ],
    })
  })

  it('revoke attribute for testService via meta transaction', async () => {
    const attributeName = 'did/svc/testService'
    const serviceEndpointParams = { uri: 'https://didcomm.example.com', transportType: 'http' }
    const attributeValue = JSON.stringify(serviceEndpointParams)
    const hash = await ethrDid.createRevokeAttributeHash(attributeName, attributeValue)
    const signature = new SigningKey(currentOwnerPrivateKey).sign(hash)

    await walletSigner.revokeAttributeSigned(attributeName, attributeValue, {
      sigV: signature.v,
      sigR: signature.r,
      sigS: signature.s,
    })

    const resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${identity}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-2`,
          blockchainAccountId: `eip155:1337:${delegate2}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-2`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-2`],
      service: [
        {
          id: `${did}#service-2`,
          serviceEndpoint: {
            transportType: 'http',
            uri: 'https://didcomm.example.com',
          },
          type: 'test2Service',
        },
      ],
    })
  })

  it('change owner via meta transaction', async () => {
    const nextOwner = accounts[2]
    const hash = await ethrDid.createChangeOwnerHash(nextOwner)
    const signature = new SigningKey(currentOwnerPrivateKey).sign(hash)

    await walletSigner.changeOwnerSigned(nextOwner, {
      sigV: signature.v,
      sigR: signature.r,
      sigS: signature.s,
    })

    const resolved = await resolver.resolve(did)
    expect(resolved.didDocument).toEqual({
      '@context': expect.anything(),
      id: did,
      verificationMethod: [
        expect.objectContaining({
          id: `${did}#controller`,
          blockchainAccountId: `eip155:1337:${nextOwner}`,
        }),
        expect.objectContaining({
          id: `${did}#delegate-2`,
          blockchainAccountId: `eip155:1337:${delegate2}`,
        }),
      ],
      authentication: [`${did}#controller`, `${did}#delegate-2`],
      assertionMethod: [`${did}#controller`, `${did}#delegate-2`],
      service: [
        {
          id: `${did}#service-2`,
          serviceEndpoint: {
            transportType: 'http',
            uri: 'https://didcomm.example.com',
          },
          type: 'test2Service',
        },
      ],
    })
  })
})
