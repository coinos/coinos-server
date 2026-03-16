--
-- PostgreSQL database dump
--

\restrict 3gmSHpmWoAvp3M9hYnbn0eAJg2qkrJcZzqafmBmvLGVxDFS2cVhidb6yKDBdS99

-- Dumped from database version 18.3 (Debian 18.3-1.pgdg13+1)
-- Dumped by pg_dump version 18.3 (Debian 18.3-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: addresses; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.addresses (
    keyidx bigint,
    addrtype integer
);


ALTER TABLE public.addresses OWNER TO lightning;

--
-- Name: blocks; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.blocks (
    height integer,
    hash bytea,
    prev_hash bytea
);


ALTER TABLE public.blocks OWNER TO lightning;

--
-- Name: chain_moves; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.chain_moves (
    id bigint NOT NULL,
    account_channel_id bigint,
    account_nonchannel_id bigint,
    tag_bitmap bigint NOT NULL,
    credit_or_debit bigint NOT NULL,
    "timestamp" bigint NOT NULL,
    utxo bytea NOT NULL,
    spending_txid bytea,
    peer_id bytea,
    payment_hash bytea,
    block_height integer NOT NULL,
    output_sat bigint NOT NULL,
    originating_channel_id bigint,
    originating_nonchannel_id bigint,
    output_count integer
);


ALTER TABLE public.chain_moves OWNER TO lightning;

--
-- Name: chain_moves_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.chain_moves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.chain_moves_id_seq OWNER TO lightning;

--
-- Name: chain_moves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.chain_moves_id_seq OWNED BY public.chain_moves.id;


--
-- Name: channel_blockheights; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_blockheights (
    channel_id bigint,
    hstate integer,
    blockheight integer
);


ALTER TABLE public.channel_blockheights OWNER TO lightning;

--
-- Name: channel_configs; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_configs (
    id bigint NOT NULL,
    dust_limit_satoshis bigint,
    max_htlc_value_in_flight_msat bigint,
    channel_reserve_satoshis bigint,
    htlc_minimum_msat bigint,
    to_self_delay integer,
    max_accepted_htlcs integer,
    max_dust_htlc_exposure_msat bigint DEFAULT 50000000
);


ALTER TABLE public.channel_configs OWNER TO lightning;

--
-- Name: channel_configs_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.channel_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channel_configs_id_seq OWNER TO lightning;

--
-- Name: channel_configs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.channel_configs_id_seq OWNED BY public.channel_configs.id;


--
-- Name: channel_feerates; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_feerates (
    channel_id bigint,
    hstate integer,
    feerate_per_kw integer
);


ALTER TABLE public.channel_feerates OWNER TO lightning;

--
-- Name: channel_funding_inflights; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_funding_inflights (
    channel_id bigint NOT NULL,
    funding_tx_id bytea NOT NULL,
    funding_tx_outnum integer,
    funding_feerate integer,
    funding_satoshi bigint,
    our_funding_satoshi bigint,
    funding_psbt bytea,
    last_tx bytea,
    last_sig bytea,
    funding_tx_remote_sigs_received integer,
    lease_commit_sig bytea,
    lease_chan_max_msat bigint,
    lease_chan_max_ppt integer,
    lease_expiry integer DEFAULT 0,
    lease_blockheight_start integer DEFAULT 0,
    lease_fee bigint DEFAULT 0,
    lease_satoshi bigint,
    splice_amnt bigint DEFAULT 0,
    i_am_initiator integer DEFAULT 0,
    force_sign_first integer DEFAULT 0,
    remote_funding bytea,
    locked_scid bigint DEFAULT 0,
    i_sent_sigs integer DEFAULT 0
);


ALTER TABLE public.channel_funding_inflights OWNER TO lightning;

--
-- Name: channel_funding_inflights_channel_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.channel_funding_inflights_channel_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channel_funding_inflights_channel_id_seq OWNER TO lightning;

--
-- Name: channel_funding_inflights_channel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.channel_funding_inflights_channel_id_seq OWNED BY public.channel_funding_inflights.channel_id;


--
-- Name: channel_htlcs; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_htlcs (
    id bigint NOT NULL,
    channel_id bigint,
    channel_htlc_id bigint,
    direction integer,
    origin_htlc bigint,
    msatoshi bigint,
    cltv_expiry integer,
    payment_hash bytea,
    payment_key bytea,
    routing_onion bytea,
    failuremsg bytea,
    malformed_onion integer,
    hstate integer,
    shared_secret bytea,
    received_time bigint,
    partid bigint,
    localfailmsg bytea,
    we_filled integer,
    groupid bigint,
    min_commit_num bigint DEFAULT 0,
    max_commit_num bigint,
    fail_immediate integer DEFAULT 0,
    fees_msat bigint DEFAULT 0,
    updated_index bigint DEFAULT 0
);


ALTER TABLE public.channel_htlcs OWNER TO lightning;

--
-- Name: channel_htlcs_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.channel_htlcs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channel_htlcs_id_seq OWNER TO lightning;

--
-- Name: channel_htlcs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.channel_htlcs_id_seq OWNED BY public.channel_htlcs.id;


--
-- Name: channel_moves; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_moves (
    id bigint NOT NULL,
    account_channel_id bigint,
    account_nonchannel_id bigint,
    tag_bitmap bigint NOT NULL,
    credit_or_debit bigint NOT NULL,
    "timestamp" bigint NOT NULL,
    payment_hash bytea,
    payment_part_id bigint,
    payment_group_id bigint,
    fees bigint NOT NULL
);


ALTER TABLE public.channel_moves OWNER TO lightning;

--
-- Name: channel_moves_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.channel_moves_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channel_moves_id_seq OWNER TO lightning;

--
-- Name: channel_moves_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.channel_moves_id_seq OWNED BY public.channel_moves.id;


--
-- Name: channel_state_changes; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channel_state_changes (
    channel_id bigint,
    "timestamp" bigint,
    old_state integer,
    new_state integer,
    cause integer,
    message text
);


ALTER TABLE public.channel_state_changes OWNER TO lightning;

--
-- Name: channels; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channels (
    id bigint NOT NULL,
    peer_id bigint,
    short_channel_id text,
    channel_config_local bigint,
    channel_config_remote bigint,
    state integer,
    funder integer,
    channel_flags integer,
    minimum_depth integer,
    next_index_local bigint,
    next_index_remote bigint,
    next_htlc_id bigint,
    funding_tx_id bytea,
    funding_tx_outnum integer,
    funding_satoshi bigint,
    funding_locked_remote integer,
    push_msatoshi bigint,
    msatoshi_local bigint,
    fundingkey_remote bytea,
    revocation_basepoint_remote bytea,
    payment_basepoint_remote bytea,
    htlc_basepoint_remote bytea,
    delayed_payment_basepoint_remote bytea,
    per_commit_remote bytea,
    old_per_commit_remote bytea,
    local_feerate_per_kw integer,
    remote_feerate_per_kw integer,
    shachain_remote_id bigint,
    shutdown_scriptpubkey_remote bytea,
    shutdown_keyidx_local bigint,
    last_sent_commit_state bigint,
    last_sent_commit_id integer,
    last_tx bytea,
    last_sig bytea,
    closing_fee_received integer,
    closing_sig_received bytea,
    first_blocknum bigint,
    last_was_revoke integer,
    in_payments_offered integer DEFAULT 0,
    in_payments_fulfilled integer DEFAULT 0,
    in_msatoshi_offered bigint DEFAULT 0,
    in_msatoshi_fulfilled bigint DEFAULT 0,
    out_payments_offered integer DEFAULT 0,
    out_payments_fulfilled integer DEFAULT 0,
    out_msatoshi_offered bigint DEFAULT 0,
    out_msatoshi_fulfilled bigint DEFAULT 0,
    min_possible_feerate integer,
    max_possible_feerate integer,
    msatoshi_to_us_min bigint,
    msatoshi_to_us_max bigint,
    future_per_commitment_point bytea,
    last_sent_commit bytea,
    feerate_base integer,
    feerate_ppm integer,
    remote_upfront_shutdown_script bytea,
    remote_ann_node_sig bytea,
    remote_ann_bitcoin_sig bytea,
    option_static_remotekey integer DEFAULT 0,
    shutdown_scriptpubkey_local bytea,
    our_funding_satoshi bigint DEFAULT 0,
    option_anchor_outputs integer DEFAULT 0,
    full_channel_id bytea,
    funding_psbt bytea,
    closer integer DEFAULT 2,
    state_change_reason integer DEFAULT 0,
    funding_tx_remote_sigs_received integer DEFAULT 0,
    revocation_basepoint_local bytea,
    payment_basepoint_local bytea,
    htlc_basepoint_local bytea,
    delayed_payment_basepoint_local bytea,
    funding_pubkey_local bytea,
    shutdown_wrong_txid bytea,
    shutdown_wrong_outnum integer,
    local_static_remotekey_start bigint DEFAULT 0,
    remote_static_remotekey_start bigint DEFAULT 0,
    lease_commit_sig bytea,
    lease_chan_max_msat integer,
    lease_chan_max_ppt integer,
    lease_expiry integer DEFAULT 0,
    htlc_maximum_msat bigint DEFAULT '2100000000000000'::bigint,
    htlc_minimum_msat bigint DEFAULT 0,
    alias_local bigint,
    alias_remote bigint,
    scid bigint,
    require_confirm_inputs_remote integer DEFAULT 0,
    require_confirm_inputs_local integer DEFAULT 0,
    channel_type bytea,
    ignore_fee_limits integer DEFAULT 0,
    remote_feerate_base integer,
    remote_feerate_ppm integer,
    remote_cltv_expiry_delta integer,
    remote_htlc_maximum_msat bigint,
    remote_htlc_minimum_msat bigint,
    last_stable_connection bigint DEFAULT 0,
    close_attempt_height integer DEFAULT 0,
    old_scids bytea,
    withheld integer DEFAULT 0
);


ALTER TABLE public.channels OWNER TO lightning;

--
-- Name: channels_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.channels_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channels_id_seq OWNER TO lightning;

--
-- Name: channels_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.channels_id_seq OWNED BY public.channels.id;


--
-- Name: channeltxs; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.channeltxs (
    id bigint NOT NULL,
    channel_id bigint,
    type integer,
    transaction_id bytea,
    input_num integer,
    blockheight integer
);


ALTER TABLE public.channeltxs OWNER TO lightning;

--
-- Name: channeltxs_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.channeltxs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.channeltxs_id_seq OWNER TO lightning;

--
-- Name: channeltxs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.channeltxs_id_seq OWNED BY public.channeltxs.id;


--
-- Name: datastore; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.datastore (
    key bytea NOT NULL,
    data bytea,
    generation bigint
);


ALTER TABLE public.datastore OWNER TO lightning;

--
-- Name: db_upgrades; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.db_upgrades (
    upgrade_from integer,
    lightning_version text
);


ALTER TABLE public.db_upgrades OWNER TO lightning;

--
-- Name: forwards; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.forwards (
    in_channel_scid bigint NOT NULL,
    in_htlc_id bigint NOT NULL,
    out_channel_scid bigint,
    out_htlc_id bigint,
    in_msatoshi bigint,
    out_msatoshi bigint,
    state integer,
    received_time bigint,
    resolved_time bigint,
    failcode integer,
    forward_style integer,
    rowid bigint,
    updated_index bigint DEFAULT 0
);


ALTER TABLE public.forwards OWNER TO lightning;

--
-- Name: htlc_sigs; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.htlc_sigs (
    channelid integer,
    signature bytea,
    inflight_tx_id bytea,
    inflight_tx_outnum integer
);


ALTER TABLE public.htlc_sigs OWNER TO lightning;

--
-- Name: invoice_fallbacks; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.invoice_fallbacks (
    scriptpubkey bytea NOT NULL,
    invoice_id bigint
);


ALTER TABLE public.invoice_fallbacks OWNER TO lightning;

--
-- Name: invoicerequests; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.invoicerequests (
    invreq_id bytea NOT NULL,
    bolt12 text,
    label text,
    status integer
);


ALTER TABLE public.invoicerequests OWNER TO lightning;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.invoices (
    id bigint NOT NULL,
    state integer,
    msatoshi bigint,
    payment_hash bytea,
    payment_key bytea,
    label text,
    expiry_time bigint,
    pay_index bigint,
    msatoshi_received bigint,
    paid_timestamp bigint,
    bolt11 text,
    description text,
    features bytea DEFAULT '\x'::bytea,
    local_offer_id bytea,
    updated_index bigint DEFAULT 0,
    paid_txid bytea,
    paid_outnum integer
);


ALTER TABLE public.invoices OWNER TO lightning;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.invoices_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO lightning;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: local_anchors; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.local_anchors (
    channel_id bigint NOT NULL,
    commitment_index bigint,
    commitment_txid bytea,
    commitment_anchor_outnum integer,
    commitment_fee bigint,
    commitment_weight integer
);


ALTER TABLE public.local_anchors OWNER TO lightning;

--
-- Name: local_anchors_channel_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.local_anchors_channel_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.local_anchors_channel_id_seq OWNER TO lightning;

--
-- Name: local_anchors_channel_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.local_anchors_channel_id_seq OWNED BY public.local_anchors.channel_id;


--
-- Name: move_accounts; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.move_accounts (
    id bigint NOT NULL,
    name text
);


ALTER TABLE public.move_accounts OWNER TO lightning;

--
-- Name: move_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.move_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.move_accounts_id_seq OWNER TO lightning;

--
-- Name: move_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.move_accounts_id_seq OWNED BY public.move_accounts.id;


--
-- Name: network_events; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.network_events (
    id bigint NOT NULL,
    peer_id bytea NOT NULL,
    type integer NOT NULL,
    "timestamp" bigint,
    reason text,
    duration_nsec bigint,
    connect_attempted integer NOT NULL
);


ALTER TABLE public.network_events OWNER TO lightning;

--
-- Name: network_events_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.network_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.network_events_id_seq OWNER TO lightning;

--
-- Name: network_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.network_events_id_seq OWNED BY public.network_events.id;


--
-- Name: offers; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.offers (
    offer_id bytea NOT NULL,
    bolt12 text,
    label text,
    status integer
);


ALTER TABLE public.offers OWNER TO lightning;

--
-- Name: outputs; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.outputs (
    prev_out_tx bytea NOT NULL,
    prev_out_index integer NOT NULL,
    value bigint,
    type integer,
    status integer,
    keyindex integer,
    channel_id bigint,
    peer_id bytea,
    commitment_point bytea,
    confirmation_height integer,
    spend_height integer,
    scriptpubkey bytea,
    reserved_til integer,
    option_anchor_outputs integer DEFAULT 0,
    csv_lock integer DEFAULT 1,
    is_in_coinbase integer DEFAULT 0
);


ALTER TABLE public.outputs OWNER TO lightning;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.payments (
    id bigint CONSTRAINT payments_id_not_null1 NOT NULL,
    "timestamp" integer,
    status integer,
    payment_hash bytea,
    destination bytea,
    msatoshi bigint,
    payment_preimage bytea,
    path_secrets bytea,
    route_nodes bytea,
    route_channels bytea,
    failonionreply bytea,
    faildestperm integer,
    failindex integer,
    failcode integer,
    failnode bytea,
    failupdate bytea,
    msatoshi_sent bigint,
    faildetail text,
    description text,
    faildirection integer,
    bolt11 text,
    total_msat bigint,
    partid bigint,
    groupid bigint DEFAULT 0 NOT NULL,
    local_offer_id bytea,
    paydescription text,
    completed_at integer,
    failscid bigint,
    local_invreq_id bytea,
    updated_index bigint DEFAULT 0
);


ALTER TABLE public.payments OWNER TO lightning;

--
-- Name: payments_id_seq1; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.payments_id_seq1
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq1 OWNER TO lightning;

--
-- Name: payments_id_seq1; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.payments_id_seq1 OWNED BY public.payments.id;


--
-- Name: peers; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.peers (
    id bigint NOT NULL,
    node_id bytea,
    address text,
    feature_bits bytea,
    last_known_address bytea
);


ALTER TABLE public.peers OWNER TO lightning;

--
-- Name: peers_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.peers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.peers_id_seq OWNER TO lightning;

--
-- Name: peers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.peers_id_seq OWNED BY public.peers.id;


--
-- Name: penalty_bases; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.penalty_bases (
    channel_id bigint NOT NULL,
    commitnum bigint NOT NULL,
    txid bytea,
    outnum integer,
    amount bigint
);


ALTER TABLE public.penalty_bases OWNER TO lightning;

--
-- Name: runes; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.runes (
    id bigint NOT NULL,
    rune text,
    last_used_nsec bigint
);


ALTER TABLE public.runes OWNER TO lightning;

--
-- Name: runes_blacklist; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.runes_blacklist (
    start_index bigint,
    end_index bigint
);


ALTER TABLE public.runes_blacklist OWNER TO lightning;

--
-- Name: runes_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.runes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.runes_id_seq OWNER TO lightning;

--
-- Name: runes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.runes_id_seq OWNED BY public.runes.id;


--
-- Name: shachain_known; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.shachain_known (
    shachain_id bigint NOT NULL,
    pos integer NOT NULL,
    idx bigint,
    hash bytea
);


ALTER TABLE public.shachain_known OWNER TO lightning;

--
-- Name: shachains; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.shachains (
    id bigint NOT NULL,
    min_index bigint,
    num_valid bigint
);


ALTER TABLE public.shachains OWNER TO lightning;

--
-- Name: shachains_id_seq; Type: SEQUENCE; Schema: public; Owner: lightning
--

CREATE SEQUENCE public.shachains_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shachains_id_seq OWNER TO lightning;

--
-- Name: shachains_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: lightning
--

ALTER SEQUENCE public.shachains_id_seq OWNED BY public.shachains.id;


--
-- Name: transaction_annotations; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.transaction_annotations (
    txid bytea,
    idx integer,
    location integer,
    type integer,
    channel bigint
);


ALTER TABLE public.transaction_annotations OWNER TO lightning;

--
-- Name: transactions; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.transactions (
    id bytea NOT NULL,
    blockheight integer,
    txindex integer,
    rawtx bytea,
    type bigint,
    channel_id bigint
);


ALTER TABLE public.transactions OWNER TO lightning;

--
-- Name: utxoset; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.utxoset (
    txid bytea NOT NULL,
    outnum integer NOT NULL,
    blockheight integer,
    spendheight integer,
    txindex integer,
    scriptpubkey bytea,
    satoshis bigint
);


ALTER TABLE public.utxoset OWNER TO lightning;

--
-- Name: vars; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.vars (
    name character varying(32) NOT NULL,
    val character varying(255),
    intval integer,
    blobval bytea
);


ALTER TABLE public.vars OWNER TO lightning;

--
-- Name: version; Type: TABLE; Schema: public; Owner: lightning
--

CREATE TABLE public.version (
    version integer
);


ALTER TABLE public.version OWNER TO lightning;

--
-- Name: chain_moves id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.chain_moves ALTER COLUMN id SET DEFAULT nextval('public.chain_moves_id_seq'::regclass);


--
-- Name: channel_configs id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_configs ALTER COLUMN id SET DEFAULT nextval('public.channel_configs_id_seq'::regclass);


--
-- Name: channel_funding_inflights channel_id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_funding_inflights ALTER COLUMN channel_id SET DEFAULT nextval('public.channel_funding_inflights_channel_id_seq'::regclass);


--
-- Name: channel_htlcs id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_htlcs ALTER COLUMN id SET DEFAULT nextval('public.channel_htlcs_id_seq'::regclass);


--
-- Name: channel_moves id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_moves ALTER COLUMN id SET DEFAULT nextval('public.channel_moves_id_seq'::regclass);


--
-- Name: channels id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channels ALTER COLUMN id SET DEFAULT nextval('public.channels_id_seq'::regclass);


--
-- Name: channeltxs id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channeltxs ALTER COLUMN id SET DEFAULT nextval('public.channeltxs_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: local_anchors channel_id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.local_anchors ALTER COLUMN channel_id SET DEFAULT nextval('public.local_anchors_channel_id_seq'::regclass);


--
-- Name: move_accounts id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.move_accounts ALTER COLUMN id SET DEFAULT nextval('public.move_accounts_id_seq'::regclass);


--
-- Name: network_events id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.network_events ALTER COLUMN id SET DEFAULT nextval('public.network_events_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq1'::regclass);


--
-- Name: peers id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.peers ALTER COLUMN id SET DEFAULT nextval('public.peers_id_seq'::regclass);


--
-- Name: runes id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.runes ALTER COLUMN id SET DEFAULT nextval('public.runes_id_seq'::regclass);


--
-- Name: shachains id; Type: DEFAULT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.shachains ALTER COLUMN id SET DEFAULT nextval('public.shachains_id_seq'::regclass);


--
-- Name: blocks blocks_height_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.blocks
    ADD CONSTRAINT blocks_height_key UNIQUE (height);


--
-- Name: chain_moves chain_moves_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.chain_moves
    ADD CONSTRAINT chain_moves_pkey PRIMARY KEY (id);


--
-- Name: channel_blockheights channel_blockheights_channel_id_hstate_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_blockheights
    ADD CONSTRAINT channel_blockheights_channel_id_hstate_key UNIQUE (channel_id, hstate);


--
-- Name: channel_configs channel_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_configs
    ADD CONSTRAINT channel_configs_pkey PRIMARY KEY (id);


--
-- Name: channel_feerates channel_feerates_channel_id_hstate_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_feerates
    ADD CONSTRAINT channel_feerates_channel_id_hstate_key UNIQUE (channel_id, hstate);


--
-- Name: channel_funding_inflights channel_funding_inflights_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_funding_inflights
    ADD CONSTRAINT channel_funding_inflights_pkey PRIMARY KEY (channel_id, funding_tx_id);


--
-- Name: channel_htlcs channel_htlcs_channel_id_channel_htlc_id_direction_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_htlcs
    ADD CONSTRAINT channel_htlcs_channel_id_channel_htlc_id_direction_key UNIQUE (channel_id, channel_htlc_id, direction);


--
-- Name: channel_htlcs channel_htlcs_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_htlcs
    ADD CONSTRAINT channel_htlcs_pkey PRIMARY KEY (id);


--
-- Name: channel_moves channel_moves_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_moves
    ADD CONSTRAINT channel_moves_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: channeltxs channeltxs_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channeltxs
    ADD CONSTRAINT channeltxs_pkey PRIMARY KEY (id);


--
-- Name: datastore datastore_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.datastore
    ADD CONSTRAINT datastore_pkey PRIMARY KEY (key);


--
-- Name: forwards forwards_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.forwards
    ADD CONSTRAINT forwards_pkey PRIMARY KEY (in_channel_scid, in_htlc_id);


--
-- Name: invoice_fallbacks invoice_fallbacks_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoice_fallbacks
    ADD CONSTRAINT invoice_fallbacks_pkey PRIMARY KEY (scriptpubkey);


--
-- Name: invoicerequests invoicerequests_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoicerequests
    ADD CONSTRAINT invoicerequests_pkey PRIMARY KEY (invreq_id);


--
-- Name: invoices invoices_label_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_label_key UNIQUE (label);


--
-- Name: invoices invoices_payment_hash_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_payment_hash_key UNIQUE (payment_hash);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: move_accounts move_accounts_name_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.move_accounts
    ADD CONSTRAINT move_accounts_name_key UNIQUE (name);


--
-- Name: move_accounts move_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.move_accounts
    ADD CONSTRAINT move_accounts_pkey PRIMARY KEY (id);


--
-- Name: network_events network_events_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.network_events
    ADD CONSTRAINT network_events_pkey PRIMARY KEY (id);


--
-- Name: offers offers_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.offers
    ADD CONSTRAINT offers_pkey PRIMARY KEY (offer_id);


--
-- Name: outputs outputs_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.outputs
    ADD CONSTRAINT outputs_pkey PRIMARY KEY (prev_out_tx, prev_out_index);


--
-- Name: payments payments_payment_hash_partid_groupid_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_payment_hash_partid_groupid_key UNIQUE (payment_hash, partid, groupid);


--
-- Name: payments payments_pkey1; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey1 PRIMARY KEY (id);


--
-- Name: peers peers_node_id_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.peers
    ADD CONSTRAINT peers_node_id_key UNIQUE (node_id);


--
-- Name: peers peers_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.peers
    ADD CONSTRAINT peers_pkey PRIMARY KEY (id);


--
-- Name: penalty_bases penalty_bases_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.penalty_bases
    ADD CONSTRAINT penalty_bases_pkey PRIMARY KEY (channel_id, commitnum);


--
-- Name: runes runes_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.runes
    ADD CONSTRAINT runes_pkey PRIMARY KEY (id);


--
-- Name: shachain_known shachain_known_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.shachain_known
    ADD CONSTRAINT shachain_known_pkey PRIMARY KEY (shachain_id, pos);


--
-- Name: shachains shachains_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.shachains
    ADD CONSTRAINT shachains_pkey PRIMARY KEY (id);


--
-- Name: transaction_annotations transaction_annotations_txid_idx_key; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.transaction_annotations
    ADD CONSTRAINT transaction_annotations_txid_idx_key UNIQUE (txid, idx);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: utxoset utxoset_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.utxoset
    ADD CONSTRAINT utxoset_pkey PRIMARY KEY (txid, outnum);


--
-- Name: vars vars_pkey; Type: CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.vars
    ADD CONSTRAINT vars_pkey PRIMARY KEY (name);


--
-- Name: chain_moves_utxo_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX chain_moves_utxo_idx ON public.chain_moves USING btree (utxo);


--
-- Name: channel_htlcs_speedup_unresolved_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX channel_htlcs_speedup_unresolved_idx ON public.channel_htlcs USING btree (channel_id, direction) WHERE (hstate <> ALL (ARRAY[9, 19]));


--
-- Name: channel_htlcs_updated_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX channel_htlcs_updated_idx ON public.channel_htlcs USING btree (updated_index);


--
-- Name: channel_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX channel_idx ON public.htlc_sigs USING btree (channelid);


--
-- Name: channel_state_changes_channel_id; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX channel_state_changes_channel_id ON public.channel_state_changes USING btree (channel_id);


--
-- Name: forwards_created_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX forwards_created_idx ON public.forwards USING btree (rowid);


--
-- Name: forwards_updated_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX forwards_updated_idx ON public.forwards USING btree (updated_index);


--
-- Name: invoice_update_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX invoice_update_idx ON public.invoices USING btree (updated_index);


--
-- Name: invoices_pay_index; Type: INDEX; Schema: public; Owner: lightning
--

CREATE UNIQUE INDEX invoices_pay_index ON public.invoices USING btree (pay_index);


--
-- Name: local_anchors_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX local_anchors_idx ON public.local_anchors USING btree (channel_id);


--
-- Name: output_height_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX output_height_idx ON public.outputs USING btree (confirmation_height, spend_height);


--
-- Name: payments_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX payments_idx ON public.payments USING btree (payment_hash);


--
-- Name: payments_update_idx; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX payments_update_idx ON public.payments USING btree (updated_index);


--
-- Name: short_channel_id; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX short_channel_id ON public.utxoset USING btree (blockheight, txindex, outnum);


--
-- Name: utxoset_spend; Type: INDEX; Schema: public; Owner: lightning
--

CREATE INDEX utxoset_spend ON public.utxoset USING btree (spendheight);


--
-- Name: chain_moves chain_moves_account_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.chain_moves
    ADD CONSTRAINT chain_moves_account_channel_id_fkey FOREIGN KEY (account_channel_id) REFERENCES public.channels(id);


--
-- Name: chain_moves chain_moves_account_nonchannel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.chain_moves
    ADD CONSTRAINT chain_moves_account_nonchannel_id_fkey FOREIGN KEY (account_nonchannel_id) REFERENCES public.move_accounts(id);


--
-- Name: chain_moves chain_moves_originating_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.chain_moves
    ADD CONSTRAINT chain_moves_originating_channel_id_fkey FOREIGN KEY (originating_channel_id) REFERENCES public.channels(id);


--
-- Name: chain_moves chain_moves_originating_nonchannel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.chain_moves
    ADD CONSTRAINT chain_moves_originating_nonchannel_id_fkey FOREIGN KEY (originating_nonchannel_id) REFERENCES public.move_accounts(id);


--
-- Name: channel_blockheights channel_blockheights_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_blockheights
    ADD CONSTRAINT channel_blockheights_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_feerates channel_feerates_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_feerates
    ADD CONSTRAINT channel_feerates_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_funding_inflights channel_funding_inflights_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_funding_inflights
    ADD CONSTRAINT channel_funding_inflights_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_htlcs channel_htlcs_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_htlcs
    ADD CONSTRAINT channel_htlcs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_moves channel_moves_account_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_moves
    ADD CONSTRAINT channel_moves_account_channel_id_fkey FOREIGN KEY (account_channel_id) REFERENCES public.channels(id);


--
-- Name: channel_moves channel_moves_account_nonchannel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_moves
    ADD CONSTRAINT channel_moves_account_nonchannel_id_fkey FOREIGN KEY (account_nonchannel_id) REFERENCES public.move_accounts(id);


--
-- Name: channel_state_changes channel_state_changes_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channel_state_changes
    ADD CONSTRAINT channel_state_changes_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channels channels_peer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_peer_id_fkey FOREIGN KEY (peer_id) REFERENCES public.peers(id) ON DELETE CASCADE;


--
-- Name: channeltxs channeltxs_blockheight_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channeltxs
    ADD CONSTRAINT channeltxs_blockheight_fkey FOREIGN KEY (blockheight) REFERENCES public.blocks(height) ON DELETE CASCADE;


--
-- Name: channeltxs channeltxs_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channeltxs
    ADD CONSTRAINT channeltxs_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channeltxs channeltxs_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.channeltxs
    ADD CONSTRAINT channeltxs_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: htlc_sigs htlc_sigs_channelid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.htlc_sigs
    ADD CONSTRAINT htlc_sigs_channelid_fkey FOREIGN KEY (channelid) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: invoice_fallbacks invoice_fallbacks_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoice_fallbacks
    ADD CONSTRAINT invoice_fallbacks_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_local_offer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_local_offer_id_fkey FOREIGN KEY (local_offer_id) REFERENCES public.offers(offer_id);


--
-- Name: local_anchors local_anchors_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.local_anchors
    ADD CONSTRAINT local_anchors_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id);


--
-- Name: outputs outputs_confirmation_height_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.outputs
    ADD CONSTRAINT outputs_confirmation_height_fkey FOREIGN KEY (confirmation_height) REFERENCES public.blocks(height) ON DELETE SET NULL;


--
-- Name: outputs outputs_spend_height_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.outputs
    ADD CONSTRAINT outputs_spend_height_fkey FOREIGN KEY (spend_height) REFERENCES public.blocks(height) ON DELETE SET NULL;


--
-- Name: payments payments_local_invreq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_local_invreq_id_fkey FOREIGN KEY (local_invreq_id) REFERENCES public.invoicerequests(invreq_id);


--
-- Name: payments payments_local_offer_id_fkey1; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_local_offer_id_fkey1 FOREIGN KEY (local_offer_id) REFERENCES public.offers(offer_id);


--
-- Name: penalty_bases penalty_bases_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.penalty_bases
    ADD CONSTRAINT penalty_bases_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: shachain_known shachain_known_shachain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.shachain_known
    ADD CONSTRAINT shachain_known_shachain_id_fkey FOREIGN KEY (shachain_id) REFERENCES public.shachains(id) ON DELETE CASCADE;


--
-- Name: transaction_annotations transaction_annotations_channel_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.transaction_annotations
    ADD CONSTRAINT transaction_annotations_channel_fkey FOREIGN KEY (channel) REFERENCES public.channels(id);


--
-- Name: transactions transactions_blockheight_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_blockheight_fkey FOREIGN KEY (blockheight) REFERENCES public.blocks(height) ON DELETE SET NULL;


--
-- Name: utxoset utxoset_blockheight_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.utxoset
    ADD CONSTRAINT utxoset_blockheight_fkey FOREIGN KEY (blockheight) REFERENCES public.blocks(height) ON DELETE CASCADE;


--
-- Name: utxoset utxoset_spendheight_fkey; Type: FK CONSTRAINT; Schema: public; Owner: lightning
--

ALTER TABLE ONLY public.utxoset
    ADD CONSTRAINT utxoset_spendheight_fkey FOREIGN KEY (spendheight) REFERENCES public.blocks(height) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict 3gmSHpmWoAvp3M9hYnbn0eAJg2qkrJcZzqafmBmvLGVxDFS2cVhidb6yKDBdS99

