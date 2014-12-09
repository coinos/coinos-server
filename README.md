# CoinOS

CoinOS is a mobile-friendly Point-of-Sale page that merchants can use to accept Bitcoin payments.

# How it Works

* You create an account and configure some basic parameters for your storefront like a name, logo, and bitcoin receiving address
* You set an exchange rate to be used to convert from your local currency to bitcoin
* CoinOS creates a custom webpage that you can bring up on a mobile device to generate payment requests
* You enter a sale amount in your local currency and CoinOS converts it to bitcoin using your chosen exchange rate
* CoinOS creates a QR code for the payment request with your receiving address and the sale amount encoded
* CoinOS listens for transactions on the Bitcoin network and displays a notification when the requested amount is received at your address
* The details of the transaction and the exchange rate used at the time of sale are recorded and made available in a convenient report

# Technical Details

The site is programmed in HTML and Coffeescript using NodeJS and jQuery. Account details and transaction data are stored in a Redis database.  Users are responsible for providing their own receiving addresses managed with whatever wallet they prefer, so CoinOS never stores any bitcoins.

We use the websocket payment notification API from http://blockchain.info/api/api_websocket to listen for and display payment notifications in real time. The bitcoin exchange rates are fetched from http://bitcoinaverage.com/

# Installation

Install nodeJS (http://nodejs.org/) and redis (http://redis.io/).  On Ubuntu, this would be:

    sudo apt-get install nodejs redis-server
    sudo ln -sf /usr/bin/nodejs /usr/bin/node

Download and configure CoinOS:

    git clone https://github.com/thebitcoincoop/coinos
    cd coinos
    npm install  
    node app.js

Now the app should be runnning at http://localhost:3000/

# License

Copyright (C) 2012 Adam Soltys

This program is free software; you can redistribute it and/or
modify it under the terms of the GNU General Public License
as published by the Free Software Foundation; either version 2
of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
