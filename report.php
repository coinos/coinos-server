<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Bitcoin Payment Report</title>
    <script language="javascript" type="text/javascript" src="http://code.jquery.com/jquery-1.8.1.min.js"></script>
    <style>
      body, input { font-family: 'Arial'; font-size: 20px; }
      body { width: 100% }
      #total { font-size: 32px; }
      table { width: 100%; }
      td, th { min-width: 200px; text-align: left; }
    </style>
  </head>
  <body>
    <div id="container">
      Date: <input id="date" name="date" type="text" />
      <table>
        <tr>
          <th>Date</th>
          <th>Address</th>
          <th>Exchange Rate</th>
          <th>BTC</th>
          <th>CAD</th>
        </tr>
<?
$row = 1;
if (($handle = fopen("transactions.csv", "r")) !== FALSE) {
  $total_amount = 0;
  $total_value = 0;
  while (($data = fgetcsv($handle, 1000, ",")) !== FALSE) {
    $num = count($data);
    $row++;
    $value = $data[2] * $data[3];
    $total_amount += $data[2];
    $total_value += $value;
?>
        <tr>
          <td><? echo $data[1] . "<br />\n"; ?></td>
          <td><? echo $data[0] . "<br />\n"; ?></td>
          <td><? echo $data[3] . "<br />\n"; ?></td>
          <td><? echo $data[2] . "<br />\n"; ?></td>
          <td>$<? echo $value . "<br />\n"; ?></td>
        </tr>
<? }} ?>
      </table>
      <br />
      <b>
        Total BTC: <? echo $total_amount . "<br />\n"; ?>
        Total CAD: <? echo $total_value . "<br />\n"; ?>
      </b>
    </div>
  </body>
</html> 
