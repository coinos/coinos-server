<?php

$list = array (
    array($_GET['address'], $_GET['date'], $_GET['received'], $_GET['exchange'])
);

$fp = fopen('transactions.csv', 'a');

foreach ($list as $fields) {
    fputcsv($fp, $fields);
}

fclose($fp);
?>
