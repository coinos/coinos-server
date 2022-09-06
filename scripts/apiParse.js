export const addUserSearch = function(input, table) {
  var { search, starts_with, contains } = input;

  if (!table) {
    table = "users";
  }
  // if (since) cmd = cmd.havingRaw('invoices + payments + deposits + orders > ?', [0])

  if (search) {
    if (starts_with) {
      search = search + "%";
    } else if (contains) {
      search = "%" + search + "%";
    }

    var condition =
      "(" +
      table +
      ".email like '" +
      search +
      "' OR " +
      table +
      ".username like '" +
      search +
      "')";

    return condition;
  } else {
    return "";
  }
};

export const addTimeSearch = function(input, field) {
  if (!field) {
    field = "updatedAt";
  }

  var { since } = input;
  if (since) {
    condition = field + " >= '" + since + "'";

    return condition;
  } else {
    return "";
  }
};
