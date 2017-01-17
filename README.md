# CoinOS

CoinOS is a mobile-friendly point-of-sale app that merchants can use to accept Bitcoin payments.

# Features

* Setup a customized payment page with your company name and logo
* Enter sale amounts in your local currency and have them converted to an amount in bitcoin using your chosen exchange rate
* A QR code payment request is generated with your receiving address and the sale amount for your customers to scan
* Get am on-screen notification when the requested amount is received at your address
* Transactions and the exchange rate at the time of sale are recorded and can be viewed later and filtered by date range

# Installation

Install nodeJS (http://nodejs.org/) and redis (http://redis.io/).  On Ubuntu that looks like:

    sudo apt-get install nodejs redis-server

Download and configure CoinOS:

    git clone https://github.com/thebitcoincoop/coinos
    cd coinos
    npm install 
    bower install
    npm start

Now the app should be runnning at http://localhost:3001/

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
