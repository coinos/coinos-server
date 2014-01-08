# Bitcoin Point of Sale Page

This is the source code for http://pos.bitcoincoop.org/

This is a simple Point-of-Sale page that merchants can run on a tablet or phone to convert dollars to bitcoins and receive payments from customers.  

A setup page allows anyone to configure some basic parameters like title, logo, address, exchange, and commission: http://pos.bitcoincoop.org/setup

These parameters can be saved and made available at a convenient URL.

# Technical Details

The site is programmed in HTML and Coffeescript using NodeJS and jQuery. Account details and transactions are stored in a Redis database.

We use the websocket payment notification API from http://blockchain.info/api/api_websocket to listen for and display payment notifications in real time. The bitcoin exchange rates are fetched from http://bitcoincharts.com/ and cached with a 15 minute expiry.

When transactions are detected, they're logged along with the current exchange rate. A report is provided so that merchants can account for how many bitcoins they received in a given time period and see their equivalent dollar value. This allows us to insulate merchants from bitcoin market volatility by offering to purchase their bitcoins for exactly what they were worth at the time of sale.

# Installation

Install nodeJS (http://nodejs.org/) and redis (http://redis.io/) then:

    git clone https://github.com/asoltys/pos.bitcoincoop.org pos
    cd pos
    npm install  
    ./fetch_rates.sh
    coffee app

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
