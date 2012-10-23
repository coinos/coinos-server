<?php

$file = 'transactions.json'; 

$transaction = array(
  'address'=> $_GET['address'],
  'date'=> $_GET['date'],
  'received'=> $_GET['received'],
  'exchange'=> $_GET['exchange'],
  'value'=> $_GET['received'] * $_GET['exchange']
);

$json = json_decode(file_get_contents($file));
array_push($json->transactions, $transaction);
file_put_contents($file, json_encode($json));

?>
