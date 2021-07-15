
CREATE TABLE `waiting_list` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `status` enum('pending','contacted','registered') DEFAULT NULL,
  `user_id` int(11),
  KEY `user` (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=latin1;

CREATE TABLE `referrals` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `token` varchar(255) DEFAULT NULL,
  `expiry` date DEFAULT NULL,
  `status` enum('pending','active','expired','cancelled') DEFAULT NULL,
  `sponsor_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  CONSTRAINT `sponsor` FOREIGN KEY (sponsor_id) REFERENCES users (`id`),
  CONSTRAINT `sponsored` FOREIGN KEY (`user_id`) REFERENCES users (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=latin1;

ALTER TABLE invoices ADD CONSTRAINT `invoice_user` FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE invoices ADD CONSTRAINT `invoice_account` FOREIGN KEY (account_id) REFERENCES accounts (id);

ALTER TABLE orders ADD CONSTRAINT `order_user` FOREIGN KEY (user_id) REFERENCES users (id);

ALTER TABLE payments ADD CONSTRAINT `payment_user` FOREIGN KEY (user_id) REFRENCES users (id);
ALTER TABLE payments ADD CONSTRAINT `payment_account` FOREIGN KEY (account_id) REFERENCES accounts (id);

ALTER TABLE deposits ADD CONSTRAINT `deposit_user` FOREIGN KEY (user_id) REFERENCES users (id);

ALTER TABLE withdrawals ADD CONSTRAINT `withdrawal_user` FOREIGN KEY (user_id) REFERENCES users (id);

ALTER TABLE accounts ADD CONSTRAINT `account_user` FOREIGN KEY (user_id) REFERENCES accounts (id);
ALTER TABLE users ADD CONSTRAINT `user_account` FOREIGN KEY (account_id) REFERENCES accounts (id);

