-- Note:  Adding FK contraints may cause issues, so I have commented them out for now, but these need to be established

CREATE TABLE `referrals` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `token` varchar(255) DEFAULT NULL UNIQUE,
  `expiry` date DEFAULT NULL,
  `status` enum('pending','active','expired','cancelled') DEFAULT NULL,
  `sponsor_id` int(11) NOT NULL,
  `user_id` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `sponsor_id` (`sponsor_id`),
  KEY `user_id` (`user_id`)
  -- FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  -- FOREIGN KEY (`sponsor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=latin1

CREATE TABLE `waiting_list` (
  `id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` varchar(255) DEFAULT NULL UNIQUE,
  `sms` varchar(255) DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `status` enum('pending','contacted','registered','cancelled') DEFAULT 'pending',
  `notes` text DEFAULT NULL,  
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
  -- CONSTRAINT `user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=latin1