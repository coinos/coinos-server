# Bitcoin Point of Sale

This is a simple utility that a merchant can run on a tablet or phone to convert dollars to bitcoins and receive payments from clients.  A setup page allows you to configure the company title, logo, address, exchange rate, and commission.

We use the websocket payment notification API from http://blockchain.info/api/api_websocket to listen for and display payment notifications in real time. The bitcoin exchange rates are fetched from http://bitcoincharts.com/.

When transactions are detected, they are logged along with the time and current exchange rate, and a report is provided so that merchants can account for how many bitcoins they received in a given time period and see their equivalent dollar value.  If desired, merchants can then keep a cash float on hand and instruct cashiers to convert the received bitcoins to dollars on-premise at the time of payment, daily, weekly, monthly or as desired.

# Installation

The main calculator page `calculator.html` is programmed in HTML5 and should run in any modern browser.  The transaction logging and reporting functionality requires a data store.  It's currently using PHP to write to flat JSON files but am probably going to switch to NodeJS and MySQL.

# Demo Instance

http://vanbtc.ca/

# Todo

* Allow calculator configurations to be saved and assigned to an account
* Short/pretty URLs for pre-saved configurations
* Security/authentication around transaction logging
* Verify transaction logs against the blockchain
* More robust disconnect and error handling
* Better device detection and browser testing

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
