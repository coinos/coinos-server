-- MySQL dump 10.14  Distrib 5.5.68-MariaDB, for Linux (x86_64)
--
-- Host: localhost    Database: coinos
-- ------------------------------------------------------
-- Server version	5.5.68-MariaDB

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `SequelizeMeta`
--

DROP TABLE IF EXISTS `SequelizeMeta`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `SequelizeMeta` (
  `name` varchar(255) COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (`name`),
  UNIQUE KEY `name` (`name`),
  UNIQUE KEY `SequelizeMeta_name_unique` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `accounts`
--

DROP TABLE IF EXISTS `accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `accounts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `asset` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `balance` double DEFAULT NULL,
  `pending` double DEFAULT NULL,
  `name` varchar(255) DEFAULT NULL,
  `ticker` varchar(255) DEFAULT NULL,
  `precision` int(11) DEFAULT NULL,
  `domain` varchar(255) DEFAULT NULL,
  `contract` text,
  `index` int(11) NOT NULL DEFAULT '0',
  `pubkey` varchar(255) DEFAULT NULL,
  `hide` tinyint(1) DEFAULT NULL,
  `seed` varchar(255) DEFAULT NULL,
  `path` varchar(255) DEFAULT NULL,
  `network` varchar(255) DEFAULT NULL,
  `privkey` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `asset` (`asset`)
) ENGINE=InnoDB AUTO_INCREMENT=20553 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cheaters`
--

DROP TABLE IF EXISTS `cheaters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cheaters` (
  `id` int(11) NOT NULL DEFAULT '0',
  `username` varchar(255) DEFAULT NULL,
  `sum` double DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `codes`
--

DROP TABLE IF EXISTS `codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `codes` (
  `code` varchar(255) NOT NULL DEFAULT '',
  `text` text,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `deposits`
--

DROP TABLE IF EXISTS `deposits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `deposits` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `amount` double DEFAULT NULL,
  `credited` tinyint(1) DEFAULT NULL,
  `code` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4554 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `invoices`
--

DROP TABLE IF EXISTS `invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `invoices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `text` text,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `rate` double DEFAULT NULL,
  `currency` varchar(255) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  `received` double DEFAULT NULL,
  `amount` double DEFAULT NULL,
  `tip` double DEFAULT NULL,
  `network` varchar(255) DEFAULT NULL,
  `unconfidential` varchar(255) DEFAULT NULL,
  `uuid` varchar(255) DEFAULT NULL,
  `memo` text,
  `account_id` int(11) DEFAULT NULL,
  `path` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `part_of_unconfidential` (`unconfidential`(10)),
  KEY `text_index` (`text`(100)),
  KEY `unconfidential_index` (`unconfidential`(100)),
  KEY `address_index` (`address`(100))
) ENGINE=InnoDB AUTO_INCREMENT=36355 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `linkingkeys`
--

DROP TABLE IF EXISTS `linkingkeys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `linkingkeys` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `hex` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=11822 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `naughty`
--

DROP TABLE IF EXISTS `naughty`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `naughty` (
  `id` int(11) NOT NULL DEFAULT '0',
  `username` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `orders`
--

DROP TABLE IF EXISTS `orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `a1` varchar(255) DEFAULT NULL,
  `a2` varchar(255) DEFAULT NULL,
  `v1` double DEFAULT NULL,
  `v2` double DEFAULT NULL,
  `user_id` int(11) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `accepted` tinyint(1) NOT NULL DEFAULT '0',
  `a1_id` int(11) DEFAULT NULL,
  `a2_id` int(11) DEFAULT NULL,
  `rate` double AS (v2/v1) VIRTUAL,
  `completedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=389 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `payments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `hash` text,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `rate` double DEFAULT NULL,
  `currency` varchar(255) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `received` tinyint(1) DEFAULT NULL,
  `amount` double DEFAULT NULL,
  `tip` double NOT NULL DEFAULT '0',
  `confirmed` tinyint(1) NOT NULL,
  `fee` double NOT NULL DEFAULT '0',
  `network` varchar(255) DEFAULT NULL,
  `account_id` int(11) DEFAULT NULL,
  `preimage` varchar(255) DEFAULT NULL,
  `memo` text,
  `redeemed` tinyint(1) NOT NULL DEFAULT '0',
  `redeemcode` varchar(255) DEFAULT NULL,
  `path` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_redeemcode` (`redeemcode`)
) ENGINE=InnoDB AUTO_INCREMENT=25828 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `reset`
--

DROP TABLE IF EXISTS `reset`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `reset` (
  `password` varchar(255) DEFAULT NULL,
  `seed` varchar(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `unit` varchar(255) DEFAULT 'SAT',
  `symbol` varchar(255) DEFAULT NULL,
  `currency` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `twofa` tinyint(1) DEFAULT NULL,
  `pin` varchar(255) DEFAULT NULL,
  `currencies` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `otpsecret` varchar(255) DEFAULT NULL,
  `account_id` int(11) DEFAULT NULL,
  `ip` int(10) unsigned DEFAULT NULL,
  `subscriptions` text,
  `seed` varchar(255) DEFAULT NULL,
  `fiat` tinyint(1) NOT NULL DEFAULT '0',
  `index` int(11) NOT NULL DEFAULT '0',
  `verified` varchar(255) DEFAULT NULL,
  `locked` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`),
  KEY `ip` (`ip`),
  KEY `username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=14579 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `withdrawals`
--

DROP TABLE IF EXISTS `withdrawals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `withdrawals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `amount` double DEFAULT NULL,
  `completed` tinyint(1) DEFAULT NULL,
  `transit` varchar(255) DEFAULT NULL,
  `account` varchar(255) DEFAULT NULL,
  `institution` varchar(255) DEFAULT NULL,
  `notes` text,
  `email` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4118 DEFAULT CHARSET=latin1;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2021-07-15  1:26:35
