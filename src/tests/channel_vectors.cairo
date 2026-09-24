// Generated public cryptographic vectors. Test keys 1 and 2 have no assets.
use crate::channel_protocol::{ChannelState, SignedAction, Terms};
pub fn corner() -> (Terms, ChannelState, Span<felt252>, Span<SignedAction>, ChannelState) {
    let mut input = array![
        0x1, 0x2, 0x3, 0x4, 0x5, 0x1ef15c18599971b7beced415a40f0c7deacfd9b0d1819e03d723d8bc943cfca,
        0x759ca09377679ecd535a81e83039658bf40959283187c654c5416f439403cf5, 0x6, 0x9, 0xd, 0xe10,
        0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0,
        0x532fd7213bbcb0ac58da4a60321799011d96bccabcde1f3bd133ee35e7a4f8b, 0x0, 0x1, 0x0, 0x0, 0x0,
        0x1, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0, 0x1,
        0x57f6d3e113df61b2201cae2d23f295eb88f5a6f6c025b208c334e51984f588b, 0xf, 0x0, 0x1, 0x2, 0x0,
        0x0, 0x0, 0x2489f10e57c8010dc0048f083fca7750e29462436a974dadea2e28d127635e4,
        0x2b4faa17592c9da5ede8addb5f2153bdfd5cf6a710c5df6002eb5ea2d66ebee, 0x0, 0x2, 0x0, 0x0, 0x0,
        0x0, 0x6c0a454dc428a7a4993e75d3167c25a36907d3f76cf31b93b64214f16eebc40,
        0x2ed57a35b561c3cc75e4d48f024ee89a0b6710ea9051ca33efb27ba905097be, 0x0, 0x1, 0xa, 0x0, 0x0,
        0x0, 0x5ced6be55dae1f7222a208ca3ce516c5fd52709ce9c0e6bef31386c4daf369f,
        0x2c8dd7276a009e2402575af1e2ae90b074fe2b4e599dc719aa79ddfdae7d2d3, 0x0, 0x2, 0x1, 0x0, 0x0,
        0x0, 0x72be5b31695c5e04636f9452f4d6828adaca98800b13d5f16f96a98ecd9e037,
        0x507fbed2d0a03f6e1dbf5dfed3fca28a1199522c03988ad084ddc3531a4ec8, 0x0, 0x1, 0x12, 0x0, 0x0,
        0x0, 0x79ed8b49cb9f06b699ae0199bc643ba3b1821c69b156a5cb319c570d87e6e47,
        0x5114e6d6f7ebc9fc5a39681e2c62f0b7b49ddec424140e101fefd58dd4f48bc, 0x0, 0x2, 0x50, 0x0, 0x0,
        0x0, 0x13e9986bdc0191d6d2eeb67fe9e699701c05449bf3a7ccc231136ececffa67e,
        0x7ee4c82c7f0a0a8c29da903896bb4091d89c46f6a5fdcdc0be48219d03c67b3, 0x1, 0x1, 0x169, 0x0,
        0x0, 0x0, 0x411d046bb2cf54c3dfc0f614a02112d168c135717d4bb156f0e775864b6055d,
        0x77a3ad1ee3a8e2d7453ed80a26ed0e58e354e2aa5a78797fa7f560a4d9f0348, 0x1, 0x2, 0x169, 0x0,
        0x0, 0x0, 0x4e630b2f922f74e1210bb2b9e83351ffe1662fa4ed032e447211d5b4f68a327,
        0x15826cf0e0082f97ad88a7638639d134449f413486de8dc49481625cc5d459e, 0x2, 0x1, 0x169, 0x3,
        0x0, 0x0, 0x46f3e686341d3ed26b88fc5b1f85c3acac2d6b37dcf367cd7c3ef9cc9498d1e,
        0x42f90ee7c275ac71e85b9fa971522d428e456a6dd455717a5ac14ac719ea4d5, 0x4, 0x2, 0x169, 0x0,
        0x0, 0x0, 0x2e60f0c6db8bd3554976bc47b11b0a80091768f9da439bd6bbde80c6a8589de,
        0x6f086d7c0818972d38be88d733ffe240d167af23a31190fe1b50315e6b5e551, 0x0, 0x1, 0x9, 0x0, 0x0,
        0x0, 0x7097ad44e63be621316705e3cba28d5e1a583b0d25492e5c7dc3ac01a96f42f,
        0x6257dc1dc90054f48f790ceee3a24540c003a42c51c5bcf2d5ab6cd07af73d5, 0x1, 0x2, 0x169, 0x0,
        0x0, 0x0, 0x3155d97465cc2d9625681e33b6911b223ecd3002de6d9ed014b15ea759d596b,
        0x3e88798d6da61c79d64f70b4a3955fe1a9e9980cb66d890807649c4b8dbdf9d, 0x1, 0x1, 0x169, 0x0,
        0x0, 0x0, 0x58e959807c83c4fa1c860bff926b8e75987a6a5ee7eff67b84671a0c3b3831f,
        0x2d9b2c1631c97c7aa759f9b7b68ae537f18d755b74111a53bf8680bb45dbcf2, 0x2, 0x2, 0x169, 0x0,
        0x0, 0x0, 0x7f70ffd813cda6e9847eccecadd56353948420ddc3e3266e3e175cfb907e921,
        0x3afee0131c5037e337604de30789d67c28ddc77937b3fe0bfa8b1255fa25ccc, 0x3, 0x1, 0x169, 0x0,
        0x0, 0x0, 0x638eb8afff62c202977845c63e9d1adaf37b8f2966982228b1d38607f338927,
        0x277504e1b488ec8451e345831b6bc71d742646fd4414eda5b3989f8fea37e04,
    ]
        .span();
    let terms = Serde::<Terms>::deserialize(ref input).unwrap();
    let start = Serde::<ChannelState>::deserialize(ref input).unwrap();
    let history = Serde::<Span<felt252>>::deserialize(ref input).unwrap();
    let actions = Serde::<Span<SignedAction>>::deserialize(ref input).unwrap();
    assert!(input.is_empty());
    let mut output = array![
        0xf, 0xb, 0x40604, 0x0, 0x0, 0x100000000000000000000, 0x0, 0x0,
        0x12869a03c4df0e4072182b288e33f78c3c5e5a226ac944be19aff72c998dbcf,
        0x4aabcc6904b0cd27659b96763cfd28f63a1464396f098495be1e938c6386d71, 0x1, 0x2, 0x2, 0x2, 0x2,
        0x1, 0x0, 0x0, 0x0, 0x2, 0x0, 0x2, 0x1, 0xc, 0xf, 0xf, 0x1,
    ]
        .span();
    let expected = Serde::<ChannelState>::deserialize(ref output).unwrap();
    (terms, start, history, actions, expected)
}
