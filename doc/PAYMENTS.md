# This document describes the types of transactions and accounts that can occur in CoinOS

## Receive bitcoin

There are four ways a user can receive bitcoin

- Bitcoin
- Liquid
- Lightning
- Internal

In every case, a payment record is added to the `payments` table
The payment `type` will be one of BTC, LBTC, LNBTC, or COINOS
The `amount` will be a positive integer representing the number of satoshis received

In the case of Bitcoin and Liquid payments, the `confirmed` column will be set to `false` initially until the transaction
is mined into a block on the blockchain.

Also, the payment amount will be reflected in users' active account record in the `accounts` table under the `pending` column. The `balance` column will be updated when confirmations are received and the `pending` amount will be debited.

## Send bitcoin

Users can also send bitcoin over any of the four networks by pasting in or scanning a QR code of a bitcoin or liquid address, lightning invoice, or username.

In the case of lightning, it's also possible to paste an [LNURL](https://github.com/fiatjaf/lnurl-rfc) which is a way of getting a lightning invoice from a remote server or other wallet over HTTP.

If scanning or pasting an address or invoice that happens to belong to another coinos user, coinos will detect that and automatically change the payment type to an internal COINOS transfer as if you had typed in the recipient's username.

## Creating Liquid Assets

Users can issue new assets on the Liquid network at https://coinos.io/asset

This will create an on-chain transaction that will issue a specified amount of new tokens. A new account record will be created in the `accounts` table for the user to track their balance of the new asset. As with receiving bitcoin over the Liquid network, the balance will be `pending` until one block confirmation has been received and then it will be updated.

A separate payment record will be created to cover the fee for the issuance transaction, which is paid in L-BTC.


## Receiving Liquid Assets

If the user has not received a particular asset before, a new account will be generated for them at the time the payment is detected.

## Sending Liquid Assets

Users can choose from a drop down menu to pick which account they want to be the active one. In the case of Liquid assets, they will only be able to an internal transfer to another coinos user, or send to a Liquid address. Users will receive an error if they paste in an LN invoice or on-chain BTC address while they have a Liquid asset accounted selected as their active account.

## Depositing Fiat

After having their account verified, users can fill out the deposit form at https://coinos.io/funding to indicate that they intend to send an interac or wire transfer. If the user is added to the list of accounts enabled for auto-deposit (under the `imap` config in config/index.js) then coinos will parse the Interac email it receives and automatically generate a new payment record and update the users Bitcoin account balance to credit them with an amount of bitcoin calculated equivalent to the fiat amount received, based on the current exchange rate less 2%.

## Withdrawing Fiat

Fiat withdrawals are currently processed manually. When a user requests to withdraw, we manually calculate how much bitcoin to remove from their account and do that with a database query before sending them an interac or wire transfer.
