//! The 529-step, board-filling stress game (`offchain/fixtures/stress_19_2.json`):
//! the longest record and the heaviest render. Its `token_uri` must fit the
//! 100M gas Juno allows a `starknet_call` by default.
use arbiter::Move;
use arbiter::clocks::{Standard, encode};
use surround_rules::go::{AGREEMENT, GoAction};
use surround_rules::replay::{go, pass, stone};
use surround_rules::rules::{Bits, Position};
use crate::kifu::record;
use crate::kifu::render::{self, Game};

fn steps() -> Span<Move<GoAction>> {
    array![
        stone(290), stone(14), stone(322), stone(130), stone(42), stone(109), stone(38), stone(356),
        stone(97), stone(220), stone(96), stone(128), stone(15), stone(1), stone(195), stone(233),
        stone(196), stone(197), stone(49), stone(309), stone(80), stone(50), stone(183), stone(169),
        stone(138), stone(117), stone(236), stone(302), stone(186), stone(89), stone(260),
        stone(215), stone(311), stone(107), stone(324), stone(273), stone(330), stone(192),
        stone(66), stone(65), stone(178), stone(30), stone(146), stone(190), stone(341), stone(86),
        stone(294), stone(46), stone(31), stone(21), stone(272), stone(4), stone(358), stone(92),
        stone(276), stone(68), stone(23), stone(345), stone(54), stone(57), stone(295), stone(222),
        stone(51), stone(105), stone(36), stone(93), stone(162), stone(283), stone(338), stone(231),
        stone(106), stone(141), stone(0), stone(350), stone(325), stone(337), stone(248), stone(22),
        stone(245), stone(78), stone(142), stone(99), stone(122), stone(187), stone(150),
        stone(208), stone(239), stone(69), stone(27), stone(293), stone(121), stone(200), stone(52),
        stone(72), stone(224), stone(9), stone(188), stone(13), stone(76), stone(3), stone(247),
        stone(203), stone(143), stone(7), stone(241), stone(120), stone(288), stone(281),
        stone(139), stone(261), stone(63), stone(305), stone(259), stone(77), stone(202),
        stone(268), stone(179), stone(20), stone(280), stone(158), stone(254), stone(327),
        stone(291), stone(306), stone(118), stone(286), stone(25), stone(73), stone(184), stone(43),
        stone(251), stone(140), stone(271), stone(103), stone(8), stone(333), stone(237), stone(98),
        stone(198), stone(173), stone(326), stone(343), stone(147), stone(55), stone(265),
        stone(90), stone(59), stone(151), stone(39), stone(110), stone(71), stone(213), stone(250),
        stone(229), stone(246), stone(282), stone(155), stone(156), stone(277), stone(85),
        stone(212), stone(163), stone(243), stone(351), stone(53), stone(284), stone(45),
        stone(279), stone(217), stone(18), stone(278), stone(83), stone(37), stone(104), stone(339),
        stone(75), stone(115), stone(145), stone(102), stone(137), stone(318), stone(70),
        stone(214), stone(253), stone(112), stone(165), stone(223), stone(82), stone(58), stone(48),
        stone(328), stone(225), stone(87), stone(47), stone(17), stone(160), stone(207), stone(95),
        stone(175), stone(303), stone(275), stone(159), stone(126), stone(29), stone(191),
        stone(61), stone(5), stone(28), stone(26), stone(252), stone(230), stone(335), stone(194),
        stone(12), stone(266), stone(100), stone(189), stone(113), stone(193), stone(34),
        stone(174), stone(164), stone(32), stone(136), stone(166), stone(144), stone(314),
        stone(131), stone(116), stone(56), stone(114), stone(221), stone(210), stone(258),
        stone(242), stone(161), stone(153), stone(24), stone(176), stone(168), stone(101),
        stone(332), stone(10), stone(255), stone(319), stone(219), stone(33), stone(238),
        stone(308), stone(256), stone(204), stone(181), stone(347), stone(44), stone(135),
        stone(119), stone(129), stone(264), stone(317), stone(40), stone(60), stone(285),
        stone(123), stone(167), stone(154), stone(234), stone(216), stone(209), stone(148),
        stone(19), stone(227), stone(11), stone(342), stone(270), stone(149), stone(199), stone(35),
        stone(206), stone(304), stone(133), stone(235), stone(180), stone(124), stone(329),
        stone(157), stone(218), stone(262), stone(211), stone(127), stone(301), stone(79),
        stone(201), stone(88), stone(152), stone(182), stone(108), stone(296), stone(62), stone(41),
        stone(355), stone(171), stone(249), stone(269), stone(257), stone(263), stone(240),
        stone(232), stone(170), stone(233), stone(78), stone(172), stone(299), stone(230),
        stone(323), stone(340), stone(6), stone(274), stone(211), stone(244), stone(192),
        stone(267), stone(67), stone(81), stone(349), stone(287), stone(331), stone(300),
        stone(111), stone(118), stone(119), stone(134), stone(359), stone(125), stone(64),
        stone(26), stone(320), stone(100), stone(117), stone(45), stone(164), stone(352),
        stone(145), stone(215), stone(8), stone(27), stone(99), stone(253), stone(346), stone(321),
        stone(320), stone(289), stone(152), stone(301), stone(98), stone(163), stone(136),
        stone(336), stone(264), stone(303), stone(205), stone(344), stone(346), stone(144),
        stone(25), stone(307), stone(268), stone(226), stone(316), stone(292), stone(354),
        stone(133), stone(298), stone(165), stone(145), stone(77), stone(282), stone(310),
        stone(177), stone(283), stone(297), stone(334), stone(327), stone(173), stone(137),
        stone(228), stone(27), stone(26), stone(190), stone(164), stone(185), stone(281),
        stone(313), stone(192), stone(312), stone(353), stone(120), stone(156), stone(315),
        stone(249), stone(334), stone(342), stone(45), stone(353), stone(352), stone(239),
        stone(240), stone(141), stone(159), stone(203), stone(256), stone(222), stone(343),
        stone(140), stone(221), stone(220), stone(161), stone(186), stone(160), stone(348),
        stone(257), stone(158), stone(219), stone(201), stone(199), stone(118), stone(136),
        stone(255), stone(221), stone(181), stone(119), stone(209), stone(258), stone(240),
        stone(238), stone(117), stone(98), stone(120), stone(185), stone(180), stone(218),
        stone(342), stone(160), stone(186), stone(357), stone(304), stone(159), stone(285),
        stone(306), stone(132), stone(206), stone(345), stone(187), stone(137), stone(327),
        stone(225), stone(170), stone(346), stone(167), stone(99), stone(305), stone(200),
        stone(218), stone(168), stone(258), stone(353), stone(279), stone(151), stone(298),
        stone(357), stone(312), stone(219), stone(315), stone(205), stone(257), stone(297),
        stone(337), stone(199), stone(356), stone(352), stone(334), stone(316), stone(335),
        stone(286), stone(206), stone(351), stone(293), stone(256), stone(331), stone(161),
        stone(313), stone(238), stone(332), stone(305), stone(355), stone(159), stone(333),
        stone(360), stone(258), stone(187), stone(349), stone(350), pass(), stone(257), pass(),
        stone(354), stone(312), stone(335), stone(333), stone(169), stone(315), stone(299),
        stone(293), stone(332), stone(298), stone(313), stone(337), stone(356), pass(), stone(331),
        stone(293), stone(279), pass(), stone(334), pass(), stone(312), pass(), pass(),
        go(GoAction::Propose(Bits { low: 0x0, mid: 0x0, high: 0x0 })), go(GoAction::Accept),
    ]
        .span()
}

fn board() -> Position {
    Position {
        black: Bits {
            low: 0xff7c047b0183b0801c7806fb80828000,
            mid: 0xeffffb5fdbd6bfdfbdfdfb7efefdfef2,
            high: 0x177df7ddd76f7dbbbdfebfdaedb,
        },
        white: Bits { low: 0x2fb80366c0b7b6185f9007b787bda, mid: 0xd, high: 0x0 },
    }
}

/// The game's record, as the SDK's `encodeKifu` also packs it.
const RECORD: [felt252; 20] = [
    0x549b6d43ac198da63b48781a42194d7f4b75bc760d166e7eedb96720762e05,
    0x9c45a7f915f69c9c723518413c81717c4995118670c8ed68768f1ff3d587a8,
    0x6c7e7f345976e7b45a3fd7f9716e90003ffca98f5ee71552447651faebf45e,
    0x799ebb4e81a701c74ff5bccbc75a8e84f3c16e74a32d4be5ea555b9c900015,
    0x7814cb0aca406131138f095224f0a9a3ed00ae71c46086696cdb517478f79b,
    0x2f252d2ce784d2c532e81067f3353f37fa3970034912880c27fdff9fca25fd,
    0x39424ad7ae51aea8ae86eb0bae52bc2601f35328479d3896dd90fce8e94a18,
    0x643a02d000a8735f5420175db75bab4a1975b784b68948deee38ecd419143f,
    0x1b3913a3e3fc44ba081bf195b93fd215ee4b4fae435b836563a64e7219e135,
    0x88793661e9bb90cb2ceba3012dd906822b4039a7084d9a00e118d438bdf5d1,
    0x6ec33b2e6c836abd813da8451b4e9cac2360853d51fe55be7ce02cbda2f875,
    0x9d01e23b6d8f3ce39c58d03170b4f92a004488419ce2878a4bb0b3de860198,
    0x8cbd3bd96eb77b91529d45b776207e5e9d5b595a7166690b2b281cc9dc6afa,
    0x6cfc58b8ddbcfaa449f64d665a4ed2ccd1c7e0efde865fd2b0d9e493d9a4d6,
    0x3547a5dfbf11338d735f94f8f645e76798a2474bcc4cca9d90e7b13a96c7d7,
    0x750ccbc2c2f8e38b74a27a3b3b9a7086b5629e9c35ad2809a2dd5268132936,
    0x8a8964f6684bb9258b1fcedc2152e9e6692984b28650330fb87cdc21b015ff,
    0xa3d5473b4f4a71cd8d14d561a7e511d9f8a5e391dc16f26207fd458c2e9f98,
    0xfbfbf7fbfffdfbffedfff7fedf7f00021eed1aac9c0e07f3fcb66631e14d,
    0x5df7df775dbdf6eef7faf0000f6bb6fbfffed7f6f5aff7ef7f7ed,
];

#[test]
fn the_longest_game_packs_into_20_felts() {
    let packed = record::encode(19, steps(), board());
    assert_eq!(packed.span(), RECORD.span());
    let unpacked = record::decode(19, 529, RECORD.span());
    assert_eq!(unpacked.steps.span(), steps());
    assert_eq!(unpacked.board, board());
}

#[test]
#[available_gas(100000000)]
fn the_longest_game_renders_inside_a_calls_gas() {
    let mut game = Game {
        id: 7,
        size: 19,
        komi_half: 13,
        black: 'BLACK',
        white: 'WHITE',
        winner: 1,
        reason: AGREEMENT,
        clock: encode(
            @Standard { turn_ms: 60000, bank_ms: 0, increment_ms: 0, byoyomi: Option::None },
        ),
        settled_at: 1790208000,
        record: record::decode(19, 529, RECORD.span()),
    };
    let uri = render::token_uri(ref game);
    assert!(uri.len() > 10000);
}
