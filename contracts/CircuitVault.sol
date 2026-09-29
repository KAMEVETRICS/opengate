// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice The TapeOut processor (circuits contract): an ERC-721 whose tokens are
/// taped-out circuits, each callable as a pure on-chain function via eval().
interface ICircuits {
    function eval(uint256 circuitId, bytes calldata input) external view returns (bytes memory);
    function circuitInfo(uint256 circuitId)
        external
        view
        returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount);
    function balanceOf(address owner) external view returns (uint256);
    function transistors() external view returns (address);
}

/// @title CircuitVault
/// @notice Stake a processor's transistors (NAND / LATCH, ERC-1155) and earn OKB.
/// Your reward weight is decided by a taped-out TapeOut circuit: the vault feeds
/// your on-chain facts (stake size, stake age, builder status, IGNIX holding) into
/// the circuit's eval() and uses the returned level. The policy lives in hardware
/// on X Layer; changing it means taping out a new circuit and waiting a timelock.
///
/// Safety properties:
///  - Unstaking never depends on the circuit. If eval() reverts or returns junk,
///    the staker falls back to level 0 and can always withdraw.
///  - The owner can never move staked transistors or funded rewards.
///  - Funding while a period is active raises the rate for the remaining time
///    instead of stretching the period, so dust deposits cannot dilute rewards.
contract CircuitVault is IERC1155Receiver, Ownable2Step, ReentrancyGuard {
    uint256 public constant NAND = 0;
    uint256 public constant LATCH = 1;

    uint8 public constant N_IN = 6;
    uint8 public constant N_OUT = 3;
    uint256 public constant BASE_WEIGHT_BPS = 10_000; // 1.00x
    uint256 public constant LEVEL_STEP_BPS = 2_500; // +0.25x per level
    uint256 public constant CIRCUIT_TIMELOCK = 2 days;
    uint256 public constant EVAL_GAS = 1_000_000;

    ICircuits public immutable circuits;
    IERC1155 public immutable transistors;
    IERC20 public immutable ignix;
    uint256 public immutable ignixThreshold;
    uint256 public immutable rewardsDuration;

    uint256 public circuitId;
    uint256 public pendingCircuitId;
    uint256 public pendingCircuitEta;

    // Stake size and age thresholds that map to the circuit's 2-bit buckets.
    uint256[3] public sizeThresholds = [100, 1_000, 10_000];
    uint256[3] public ageThresholds = [1 days, 7 days, 30 days];

    // Reward accounting (Synthetix-style, per unit of weight).
    uint256 public rewardRate; // wei per second
    uint256 public periodFinish;
    uint256 public lastUpdateTime;
    uint256 public rewardPerWeightStored;
    uint256 public totalWeight;

    struct Staker {
        uint128 nand;
        uint128 latch;
        uint64 stakeStart;
        uint8 level;
        uint256 weight;
        uint256 rewardPerWeightPaid;
        uint256 rewards;
    }

    mapping(address => Staker) public stakers;

    bool private _pulling;

    event Staked(address indexed user, uint256 nand, uint256 latch);
    event Unstaked(address indexed user, uint256 nand, uint256 latch);
    event LevelUpdated(address indexed user, uint8 level, uint256 weight, bool evalOk);
    event RewardPaid(address indexed user, uint256 amount);
    event Funded(address indexed funder, uint256 amount, uint256 rewardRate, uint256 periodFinish);
    event CircuitProposed(uint256 circuitId, uint256 eta);
    event CircuitActivated(uint256 circuitId);

    error ZeroAmount();
    error InsufficientStake();
    error BadCircuit();
    error TimelockActive();
    error NothingPending();
    error DirectTransfer();
    error TransferFailed();

    constructor(
        address circuits_,
        uint256 circuitId_,
        address ignix_,
        uint256 ignixThreshold_,
        uint256 rewardsDuration_,
        address owner_
    ) Ownable(owner_) {
        circuits = ICircuits(circuits_);
        transistors = IERC1155(ICircuits(circuits_).transistors());
        ignix = IERC20(ignix_);
        ignixThreshold = ignixThreshold_;
        rewardsDuration = rewardsDuration_;
        _checkCircuit(circuitId_);
        circuitId = circuitId_;
        emit CircuitActivated(circuitId_);
    }

    // ---------------------------------------------------------------- views

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerWeight() public view returns (uint256) {
        if (totalWeight == 0) return rewardPerWeightStored;
        return rewardPerWeightStored
            + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRate * 1e18) / totalWeight;
    }

    function earned(address user) public view returns (uint256) {
        Staker storage s = stakers[user];
        return s.rewards + (s.weight * (rewardPerWeight() - s.rewardPerWeightPaid)) / 1e18;
    }

    function stakedOf(address user) public view returns (uint256) {
        Staker storage s = stakers[user];
        return uint256(s.nand) + uint256(s.latch);
    }

    /// @notice The 6-bit input byte the vault would feed the circuit for `user` right now.
    function circuitInput(address user) public view returns (bytes1) {
        Staker storage s = stakers[user];
        uint256 amount = uint256(s.nand) + uint256(s.latch);
        uint8 size = _bucket(amount, sizeThresholds);
        uint8 age = amount == 0 ? 0 : _bucket(block.timestamp - s.stakeStart, ageThresholds);
        uint8 isBuilder = _balanceAtLeast(address(circuits), user, 1) ? 1 : 0;
        uint8 isHolder = address(ignix) != address(0) && _balanceAtLeast(address(ignix), user, ignixThreshold) ? 1 : 0;
        return bytes1(size | (age << 2) | (isBuilder << 4) | (isHolder << 5));
    }

    /// @dev balanceOf(user) >= min, treating a reverting or malformed token as 0 so a
    /// broken external contract can never block staking, poking or claiming.
    function _balanceAtLeast(address token, address user, uint256 min) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            token.staticcall{gas: 100_000}(abi.encodeWithSelector(IERC20.balanceOf.selector, user));
        if (!ok || ret.length < 32) return false;
        return abi.decode(ret, (uint256)) >= min;
    }

    /// @notice Level the circuit returns for `user` right now, and whether eval() succeeded.
    function previewLevel(address user) public view returns (uint8 level, bool ok) {
        bytes memory input = abi.encodePacked(circuitInput(user));
        // Low-level call: try/catch would still revert on a codeless target or on
        // return data that fails to decode.
        (bool success, bytes memory ret) = address(circuits).staticcall{gas: EVAL_GAS}(
            abi.encodeWithSelector(ICircuits.eval.selector, circuitId, input)
        );
        // ABI-encoded `bytes`: 32-byte offset, 32-byte length, then data.
        if (!success || ret.length < 96) return (0, false);
        uint256 offset;
        uint256 len;
        assembly {
            offset := mload(add(ret, 32))
        }
        if (offset != 32) return (0, false);
        assembly {
            len := mload(add(ret, 64))
        }
        if (len == 0 || len > ret.length - 64) return (0, false);
        return (uint8(ret[64]) & 0x07, true);
    }

    function weightFor(uint256 amount, uint8 level) public pure returns (uint256) {
        return (amount * (BASE_WEIGHT_BPS + uint256(level) * LEVEL_STEP_BPS)) / BASE_WEIGHT_BPS;
    }

    // ---------------------------------------------------------------- staking

    /// @notice Stake transistors. Requires transistors.setApprovalForAll(vault, true).
    function stake(uint256 nand, uint256 latch) external nonReentrant {
        if (nand + latch == 0) revert ZeroAmount();
        _updateReward(msg.sender);
        Staker storage s = stakers[msg.sender];
        if (uint256(s.nand) + uint256(s.latch) == 0) s.stakeStart = uint64(block.timestamp);
        s.nand += uint128(nand);
        s.latch += uint128(latch);

        _pulling = true;
        if (nand > 0) transistors.safeTransferFrom(msg.sender, address(this), NAND, nand, "");
        if (latch > 0) transistors.safeTransferFrom(msg.sender, address(this), LATCH, latch, "");
        _pulling = false;

        emit Staked(msg.sender, nand, latch);
        _refreshLevel(msg.sender);
    }

    /// @notice Unstake transistors. A partial unstake restarts your stake age.
    /// Never calls the circuit, so it works even if eval() is broken.
    function unstake(uint256 nand, uint256 latch) public nonReentrant {
        if (nand + latch == 0) revert ZeroAmount();
        Staker storage s = stakers[msg.sender];
        if (nand > s.nand || latch > s.latch) revert InsufficientStake();
        _updateReward(msg.sender);
        s.nand -= uint128(nand);
        s.latch -= uint128(latch);

        uint256 left = uint256(s.nand) + uint256(s.latch);
        s.stakeStart = left == 0 ? 0 : uint64(block.timestamp);
        // Drop to level 0 without consulting the circuit; poke() can raise it again.
        _setWeight(msg.sender, 0, false);

        if (nand > 0) transistors.safeTransferFrom(address(this), msg.sender, NAND, nand, "");
        if (latch > 0) transistors.safeTransferFrom(address(this), msg.sender, LATCH, latch, "");
        emit Unstaked(msg.sender, nand, latch);
    }

    function claim() public nonReentrant {
        _updateReward(msg.sender);
        uint256 amount = stakers[msg.sender].rewards;
        if (amount == 0) return;
        stakers[msg.sender].rewards = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit RewardPaid(msg.sender, amount);
    }

    /// @notice Re-run the circuit for `user` (anyone may call). Stake age grows over
    /// time and IGNIX balances change, so levels go stale until someone pokes.
    function poke(address user) external nonReentrant {
        _updateReward(user);
        _refreshLevel(user);
    }

    // ---------------------------------------------------------------- funding

    /// @notice Add OKB rewards. Starts a new period, or raises the rate of the active one.
    function fund() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        _updateReward(address(0));
        if (block.timestamp >= periodFinish) {
            rewardRate = msg.value / rewardsDuration;
            periodFinish = block.timestamp + rewardsDuration;
        } else {
            rewardRate += msg.value / (periodFinish - block.timestamp);
        }
        lastUpdateTime = block.timestamp;
        emit Funded(msg.sender, msg.value, rewardRate, periodFinish);
    }

    // ---------------------------------------------------------------- policy

    /// @notice Propose a new policy circuit (must be taped out on the same processor).
    function proposeCircuit(uint256 newCircuitId) external onlyOwner {
        _checkCircuit(newCircuitId);
        pendingCircuitId = newCircuitId;
        pendingCircuitEta = block.timestamp + CIRCUIT_TIMELOCK;
        emit CircuitProposed(newCircuitId, pendingCircuitEta);
    }

    function activateCircuit() external onlyOwner {
        if (pendingCircuitEta == 0) revert NothingPending();
        if (block.timestamp < pendingCircuitEta) revert TimelockActive();
        circuitId = pendingCircuitId;
        pendingCircuitId = 0;
        pendingCircuitEta = 0;
        emit CircuitActivated(circuitId);
    }

    // ---------------------------------------------------------------- ERC-1155 receiver

    function onERC1155Received(address operator, address, uint256, uint256, bytes calldata)
        external
        view
        returns (bytes4)
    {
        if (msg.sender != address(transistors) || operator != address(this) || !_pulling) revert DirectTransfer();
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert DirectTransfer();
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    // ---------------------------------------------------------------- internals

    function _updateReward(address user) internal {
        // While nobody is staked, pause the period instead of streaming rewards into
        // the void: push periodFinish out by the idle time so every funded wei is paid.
        if (totalWeight == 0 && lastUpdateTime < periodFinish) {
            periodFinish += lastTimeRewardApplicable() - lastUpdateTime;
        }
        rewardPerWeightStored = rewardPerWeight();
        lastUpdateTime = lastTimeRewardApplicable();
        if (user != address(0)) {
            Staker storage s = stakers[user];
            s.rewards = earned(user);
            s.rewardPerWeightPaid = rewardPerWeightStored;
        }
    }

    function _refreshLevel(address user) internal {
        (uint8 level, bool ok) = previewLevel(user);
        _setWeight(user, level, ok);
    }

    function _setWeight(address user, uint8 level, bool evalOk) internal {
        Staker storage s = stakers[user];
        uint256 w = weightFor(uint256(s.nand) + uint256(s.latch), level);
        totalWeight = totalWeight - s.weight + w;
        s.weight = w;
        s.level = level;
        emit LevelUpdated(user, level, w, evalOk);
    }

    function _checkCircuit(uint256 id) internal view {
        (uint32 nIn, uint32 nOut,,) = circuits.circuitInfo(id);
        if (nIn != N_IN || nOut != N_OUT) revert BadCircuit();
    }

    function _bucket(uint256 value, uint256[3] storage t) internal view returns (uint8) {
        if (value >= t[2]) return 3;
        if (value >= t[1]) return 2;
        if (value >= t[0]) return 1;
        return 0;
    }
}
