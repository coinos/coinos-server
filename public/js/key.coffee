Key = ->
  rng = new SecureRandom()
  bytes = new Array(256)
  rng.nextBytes(bytes)

  hasher = new jsSHA(bytes.toString(), 'TEXT')   
  rng.nextBytes(bytes)

  I = hasher.getHMAC(bytes.toString(), "TEXT", "SHA-512", "HEX")
  il = Crypto.util.hexToBytes(I.slice(0, 64))
  ir = Crypto.util.hexToBytes(I.slice(64, 128))

  key = new BIP32()
  key.eckey = new Bitcoin.ECKey(il)
  key.eckey.pub = key.eckey.getPubPoint()
  key.eckey.setCompressed(true)
  key.eckey.pubKeyHash = Bitcoin.Util.sha256ripe160(key.eckey.pub.getEncoded(true))
  key.has_private_key = true

  key.chain_code = ir
  key.child_index = 0
  key.parent_fingerprint = Bitcoin.Util.hexToBytes("00000000")
  key.version = BITCOIN_MAINNET_PRIVATE
  key.depth = 1

  key.build_extended_public_key()
  key.build_extended_private_key()
  return key
