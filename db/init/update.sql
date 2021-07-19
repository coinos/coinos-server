
DROP TABLE IF EXISTS `waiting_list`;
CREATE TABLE `waiting_list` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `status` enum('pending','contacted','registered', 'cancelled') DEFAULT NULL,
  `notes` varchar(255),
  `user_id` int(11),
  KEY `user` (`user_id`),
  FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=latin1;

DROP TABLE IF EXISTS `referrals`;
CREATE TABLE `referrals` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `token` varchar(255) DEFAULT NULL,
  `expiry` date DEFAULT NULL,
  `status` enum('available', 'used', 'expired', 'cancelled') DEFAULT NULL,
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

ALTER TABLE payments ADD CONSTRAINT `payment_user` FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE payments ADD CONSTRAINT `payment_account` FOREIGN KEY (account_id) REFERENCES accounts (id);

ALTER TABLE deposits ADD CONSTRAINT `deposit_user` FOREIGN KEY (user_id) REFERENCES users (id);

ALTER TABLE withdrawals ADD CONSTRAINT `withdrawal_user` FOREIGN KEY (user_id) REFERENCES users (id);

ALTER TABLE accounts ADD CONSTRAINT `account_user` FOREIGN KEY (user_id) REFERENCES users (id);
ALTER TABLE users ADD CONSTRAINT `user_account` FOREIGN KEY (account_id) REFERENCES accounts (id);

ALTER TABLE users ADD email varchar(255);
ALTER TABLE users ADD phone varchar(255);
ALTER TABLE users ADD admin tinyint default false;

DROP TABLE IF EXISTS `reset`;
DROP TABLE IF EXISTS `naughty`;
DROP TABLE IF EXISTS `cheaters`;

--
-- Table structure for table `migrations`
--

DROP TABLE IF EXISTS `migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `migrations` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) DEFAULT NULL,
  `batch` int(11) DEFAULT NULL,
  `migration_time` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `migrations_lock`
--

DROP TABLE IF EXISTS `migrations_lock`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `migrations_lock` (
  `index` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `is_locked` int(11) DEFAULT NULL,
  PRIMARY KEY (`index`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;


--
-- Table structure for table `urls`
--

DROP TABLE IF EXISTS `urls`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `urls` (
  `hash` varchar(255) DEFAULT NULL,
  `data` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  UNIQUE KEY `urls_hash_unique` (`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

---
--- New field changes...
---

UPDATE accounts set createdAt = '2020-01-01' where createdAt < '2020-01-01';
UPDATE accounts set updatedAt = '2020-01-01' where createdAt < '2020-01-01';
ALTER TABLE accounts modify `contract` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;

ALTER TABLE invoices modify `tip` double NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD `webhook` text DEFAULT NULL;

ALTER TABLE payments ADD `invoice_id` int(11) DEFAULT NULL;
ALTER TABLE payments modify `tip` double NOT NULL DEFAULT 0;

ALTER TABLE orders DROP a1;
ALTER TABLE orders DROP a2;

ALTER TABLE users MODIFY `unit` varchar(255) DEFAULT NULL;
ALTER TABLE users ADD `authyId` varchar(255) DEFAULT NULL;
ALTER TABLE users MODIFY `subscriptions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL;
ALTER TABLE users DROP symbol;


