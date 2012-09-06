<?php

// $ch = curl_init("https://mtgox.com/api/1/BTCCAD/ticker");
$ch = curl_init("http://www.example.com/");
echo curl_exec($ch);
curl_close($ch);
?>
