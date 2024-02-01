#!/usr/bin/perl
use strict;
use warnings;
use IO::Socket::INET;

# Auto-flush on socket
$| = 1;

# Creating a socket, connecting to the server
my $socket = new IO::Socket::INET (
    PeerHost => 'app',
    PeerPort => '3119',
    Proto => 'tcp',
) or die "ERROR in Socket Creation : $!\n";

my $txid = $ARGV[0] // die "txid not provided";
my $wallet = $ARGV[1] // die "wallet not provided";

# Define HTTP request
my $json = "{\"txid\": \"$txid\", \"wallet\": \"$wallet\", \"type\": \"liquid\"}";
my $request = "POST /confirm HTTP/1.1\r\n";
$request .= "Host: app\r\n";
$request .= "Content-Type: application/json\r\n";
$request .= "Content-Length: " . length($json) . "\r\n";
$request .= "Connection: close\r\n";
$request .= "\r\n";
$request .= $json;

# Send request to server
print $socket "$request";
shutdown($socket, 1);

# Read the response
while (my $line = <$socket>) {
    print $line;
}

# Close the socket
$socket->close();
