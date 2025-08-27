
docs.superfluid.org
SuperTokenV1Library | Superfluid | Stream Money Every Second
38–49 minutes

Library for Token Centric Interface

The SuperTokenV1Library is a solidity library that allows you to interact with the Superfluid Protocol. It is a comprehensive library for Superfluid protocol. It includes all the functions that are required to interact with the Superfluid protocol. It includes functions for interacting with Money Streaming and Distributions. In order to have access to the library, you need to:

    Import the library in your contract as such:

    import "@superfluid-finance/ethereum-contracts/contracts/apps/SuperTokenV1Library.sol";

    Make sure that you include the using statement in your contract:

    using SuperTokenV1Library for ISuperToken;

Note 1

In the case of interacting with Native Super Tokens you should use using SuperTokenV1Library for ISETH; instead.

Note 2

It is important to "warm up" the cache and cache the host, cfa, gda before calling, this is only applicable to Foundry tests where the vm.expectRevert() will not work as expected. You must use vm.startPrank(account) instead of vm.prank when executing functions if the cache isn't "warmed up" yet. vm.prank impersonates the account only for the first call, which will be used for caching.
Fn flowX​

function flowX(
    contract ISuperToken token,
    address receiverOrPool,
    int96 flowRate
)
    internal
    returns (bool)

creates a flow to an account or to pool members. If the receiver is an account, it uses the CFA, if it's a pool it uses the GDA.
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
receiverOrPool	address	The receiver (account) or pool
flowRate	int96	the flowRate to be set.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the operation was successful.
Note that all the specifics of the underlying agreement used still apply.
E.g. if the GDA is used, the effective flowRate may differ from the selected one.
Fn transferX​

function transferX(
    contract ISuperToken token,
    address receiverOrPool,
    uint256 amount
)
    internal
    returns (bool)

transfers amount to an account or distributes it to pool members.
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
receiverOrPool	address	The receiver (account) or pool
amount	uint256	the amount to be transferred/distributed
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the operation was successful.
Note in case of distribution, the effective amount may be smaller than requested.
Fn getFlowRate​

function getFlowRate(
    contract ISuperToken token,
    address sender,
    address receiverOrPool
)
    internal
    returns (int96 flowRate)

get flow rate between two accounts for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	The sender of the flow
receiverOrPool	address	The receiver or pool receiving or distributing the flow
Return Values​
Name	Type	Description
flowRate	int96	The flow rate
Note: edge case: if a CFA stream is going to a pool, it will return 0.
Fn getFlowInfo​

function getFlowInfo(
    contract ISuperToken token,
    address sender,
    address receiverOrPool
)
    internal
    returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit)

get flow info between an account and another account or pool for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	The sender of the flow
receiverOrPool	address	The receiver or pool receiving or distributing the flow
Return Values​
Name	Type	Description
lastUpdated	uint256	Timestamp of flow creation or last flowrate change
flowRate	int96	The flow rate
deposit	uint256	The amount of deposit the flow
owedDeposit	uint256	The amount of owed deposit of the flow
Note: edge case: a CFA stream going to a pool will not be "seen".
Fn getNetFlowRate​

function getNetFlowRate(
    contract ISuperToken token,
    address account
)
    internal
    returns (int96 flowRate)

get net flow rate for given account for given token (CFA + GDA)
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
account	address	Account to query
Return Values​
Name	Type	Description
flowRate	int96	The net flow rate of the account
Fn getNetFlowInfo​

function getNetFlowInfo(
    contract ISuperToken token,
    address account
)
    internal
    returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit)

get the aggregated flow info of the account (CFA + GDA)
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
account	address	Account to query
Return Values​
Name	Type	Description
lastUpdated	uint256	Timestamp of the last change of the net flow
flowRate	int96	The net flow rate of token for account
deposit	uint256	The sum of all deposits for account's flows
owedDeposit	uint256	The sum of all owed deposits for account's flows
Fn getBufferAmountByFlowRate​

function getBufferAmountByFlowRate(
    contract ISuperToken token,
    int96 flowRate
)
    internal
    returns (uint256 bufferAmount)

calculate buffer needed for a CFA flow with the given flowrate (for GDA, see 2nd notice below)
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowRate	int96	The flowrate to calculate the needed buffer for
Return Values​
Name	Type	Description
bufferAmount	uint256	The buffer amount based on flowRate, liquidationPeriod and minimum deposit

the returned amount is exact only for the scenario where no flow exists before. In order to get the buffer delta for a delta flowrate, you need to get the buffer amount for the new total flowrate and subtract the previous buffer. That's because there's not always linear proportionality between flowrate and buffer. for GDA flows, the required buffer is typically slightly lower. That's due to an implementation detail (round-up "clipping" to 64 bit in the CFA). The return value of this method is thus to be considered not a precise value, but a lower bound for GDA flows.
Fn flow​

function flow(
    contract ISuperToken token,
    address receiver,
    int96 flowRate
)
    internal
    returns (bool)

Sets the given CFA flowrate between the caller and a given receiver. If there's no pre-existing flow and flowRate non-zero, a new flow is created. If there's an existing flow and flowRate non-zero, the flowRate of that flow is updated. If there's an existing flow and flowRate zero, the flow is deleted. If the existing and given flowRate are equal, no action is taken. On creation of a flow, a "buffer" amount is automatically detracted from the sender account's available balance. If the sender account is solvent when the flow is deleted, this buffer is redeemed to it.
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
receiver	address	The receiver of the flow
flowRate	int96	The wanted flowrate in wad/second. Only positive values are valid here.
Return Values​
Name	Type	Description
[0]	bool	bool
Fn flow (with User Data)​

function flow(
    contract ISuperToken token,
    address receiver,
    int96 flowRate,
    bytes userData
)
    internal
    returns (bool)

Set CFA flowrate with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
receiver	address	The receiver of the flow
flowRate	int96	The wanted flowrate in wad/second. Only positive values are valid here.
userData	bytes	The userdata passed along with call
Return Values​
Name	Type	Description
[0]	bool	bool
Fn createFlow​

function createFlow(
    contract ISuperToken token,
    address receiver,
    int96 flowRate
)
    internal
    returns (bool)

Create flow without userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
Fn createFlow (with User Data)​

function createFlow(
    contract ISuperToken token,
    address receiver,
    int96 flowRate,
    bytes userData
)
    internal
    returns (bool)

Create flow with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
userData	bytes	The userdata passed along with call
Fn updateFlow​

function updateFlow(
    contract ISuperToken token,
    address receiver,
    int96 flowRate
)
    internal
    returns (bool)

Update flow without userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
Fn updateFlow (with User Data)​

function updateFlow(
    contract ISuperToken token,
    address receiver,
    int96 flowRate,
    bytes userData
)
    internal
    returns (bool)

Update flow with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
userData	bytes	The userdata passed along with call
Fn deleteFlow​

function deleteFlow(
    contract ISuperToken token,
    address sender,
    address receiver
)
    internal
    returns (bool)

Delete flow without userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
Fn deleteFlow (with User Data)​

function deleteFlow(
    contract ISuperToken token,
    address sender,
    address receiver,
    bytes userData
)
    internal
    returns (bool)

Delete flow with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
userData	bytes	The userdata passed along with call
Fn flowFrom​

function flowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate
)
    internal
    returns (bool)

Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The wanted flowRate in wad/second. Only positive values are valid here.
Return Values​
Name	Type	Description
[0]	bool	bool

Like flow, but can be invoked by an account with flowOperator permissions on behalf of the sender account.
Fn flowFrom (with User Data)​

function flowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate,
    bytes userData
)
    internal
    returns (bool)

Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The wanted flowRate in wad/second. Only positive values are valid here.
userData	bytes	The userdata passed along with call
Return Values​
Name	Type	Description
[0]	bool	bool

Like flowFrom, but takes userData
Fn setFlowPermissions​

function setFlowPermissions(
    contract ISuperToken token,
    address flowOperator,
    bool allowCreate,
    bool allowUpdate,
    bool allowDelete,
    int96 flowRateAllowance
)
    internal
    returns (bool)

Update permissions for flow operator
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address given flow permissions
allowCreate	bool	creation permissions
allowUpdate	bool
allowDelete	bool
flowRateAllowance	int96	The allowance provided to flowOperator
Fn setMaxFlowPermissions​

function setMaxFlowPermissions(
    contract ISuperToken token,
    address flowOperator
)
    internal
    returns (bool)

Update permissions for flow operator - give operator max permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address given flow permissions
Fn revokeFlowPermissions​

function revokeFlowPermissions(
    contract ISuperToken token,
    address flowOperator
)
    internal
    returns (bool)

Update permissions for flow operator - revoke all permission
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address given flow permissions
Fn increaseFlowRateAllowance​

function increaseFlowRateAllowance(
    contract ISuperToken token,
    address flowOperator,
    int96 addedFlowRateAllowance
)
    internal
    returns (bool)

Increases the flow rate allowance for flow operator
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is increased
addedFlowRateAllowance	int96	amount to increase allowance by

allowing userData to be a parameter here triggered stack too deep error
Fn increaseFlowRateAllowance (with User Data)​

function increaseFlowRateAllowance(
    contract ISuperToken token,
    address flowOperator,
    int96 addedFlowRateAllowance,
    bytes userData
)
    internal
    returns (bool)

Increases the flow rate allowance for flow operator
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is increased
addedFlowRateAllowance	int96	amount to increase allowance by
userData	bytes	The userdata passed along with call

allowing userData to be a parameter here triggered stack too deep error
Fn decreaseFlowRateAllowance​

function decreaseFlowRateAllowance(
    contract ISuperToken token,
    address flowOperator,
    int96 subtractedFlowRateAllowance
)
    internal
    returns (bool)

Decreases the flow rate allowance for flow operator
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is decreased
subtractedFlowRateAllowance	int96	amount to decrease allowance by

allowing userData to be a parameter here triggered stack too deep error
Fn decreaseFlowRateAllowance (with User Data)​

function decreaseFlowRateAllowance(
    contract ISuperToken token,
    address flowOperator,
    int96 subtractedFlowRateAllowance,
    bytes userData
)
    internal
    returns (bool)

Decreases the flow rate allowance for flow operator
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is decreased
subtractedFlowRateAllowance	int96	amount to decrease allowance by
userData	bytes	The userdata passed along with call

allowing userData to be a parameter here triggered stack too deep error
Fn increaseFlowRateAllowanceWithPermissions​

function increaseFlowRateAllowanceWithPermissions(
    contract ISuperToken token,
    address flowOperator,
    uint8 permissionsToAdd,
    int96 addedFlowRateAllowance
)
    internal
    returns (bool)

Increases the flow rate allowance for flow operator and adds the permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is increased
permissionsToAdd	uint8	The permissions to add for the flow operator
addedFlowRateAllowance	int96	amount to increase allowance by

allowing userData to be a parameter here triggered stack too deep error
Fn increaseFlowRateAllowanceWithPermissions (with User Data)​

function increaseFlowRateAllowanceWithPermissions(
    contract ISuperToken token,
    address flowOperator,
    uint8 permissionsToAdd,
    int96 addedFlowRateAllowance,
    bytes userData
)
    internal
    returns (bool)

Increases the flow rate allowance for flow operator and adds the permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is increased
permissionsToAdd	uint8	The permissions to add for the flow operator
addedFlowRateAllowance	int96	amount to increase allowance by
userData	bytes	The userdata passed along with call

allowing userData to be a parameter here triggered stack too deep error
Fn decreaseFlowRateAllowanceWithPermissions​

function decreaseFlowRateAllowanceWithPermissions(
    contract ISuperToken token,
    address flowOperator,
    uint8 permissionsToRemove,
    int96 subtractedFlowRateAllowance
)
    internal
    returns (bool)

Decreases the flow rate allowance for flow operator and removes the permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is subtracted
permissionsToRemove	uint8	The permissions to remove for the flow operator
subtractedFlowRateAllowance	int96	amount to subtract allowance by

allowing userData to be a parameter here triggered stack too deep error
Fn decreaseFlowRateAllowanceWithPermissions (with User Data)​

function decreaseFlowRateAllowanceWithPermissions(
    contract ISuperToken token,
    address flowOperator,
    uint8 permissionsToRemove,
    int96 subtractedFlowRateAllowance,
    bytes userData
)
    internal
    returns (bool)

Decreases the flow rate allowance for flow operator and removes the permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address whose flow rate allowance is subtracted
permissionsToRemove	uint8	The permissions to remove for the flow operator
subtractedFlowRateAllowance	int96	amount to subtract allowance by
userData	bytes	The userdata passed along with call

allowing userData to be a parameter here triggered stack too deep error
Fn createFlowFrom​

function createFlowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate
)
    internal
    returns (bool)

Creates flow as an operator without userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
Fn createFlowFrom (with User Data)​

function createFlowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate,
    bytes userData
)
    internal
    returns (bool)

Creates flow as an operator with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
userData	bytes	The user provided data
Fn updateFlowFrom​

function updateFlowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate
)
    internal
    returns (bool)

Updates flow as an operator without userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
Fn updateFlowFrom (with User Data)​

function updateFlowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate,
    bytes userData
)
    internal
    returns (bool)

Updates flow as an operator with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
userData	bytes	The user provided data
Fn deleteFlowFrom​

function deleteFlowFrom(
    contract ISuperToken token,
    address sender,
    address receiver
)
    internal
    returns (bool)

Deletes flow as an operator without userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
Fn deleteFlowFrom (with User Data)​

function deleteFlowFrom(
    contract ISuperToken token,
    address sender,
    address receiver,
    bytes userData
)
    internal
    returns (bool)

Deletes flow as an operator with userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
userData	bytes	The user provided data
Fn createFlowWithCtx​

function createFlowWithCtx(
    contract ISuperToken token,
    address receiver,
    int96 flowRate,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Create flow with context and userData
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn createFlowFromWithCtx​

function createFlowFromWithCtx(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Create flow by operator with context
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn updateFlowWithCtx​

function updateFlowWithCtx(
    contract ISuperToken token,
    address receiver,
    int96 flowRate,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Update flow with context
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn updateFlowFromWithCtx​

function updateFlowFromWithCtx(
    contract ISuperToken token,
    address sender,
    address receiver,
    int96 flowRate,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Update flow by operator with context
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The receiver of the flow
receiver	address	The receiver of the flow
flowRate	int96	The desired flowRate
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn deleteFlowWithCtx​

function deleteFlowWithCtx(
    contract ISuperToken token,
    address sender,
    address receiver,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Delete flow with context
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn deleteFlowFromWithCtx​

function deleteFlowFromWithCtx(
    contract ISuperToken token,
    address sender,
    address receiver,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Delete flow by operator with context
Parameters​
Name	Type	Description
token	contract ISuperToken	The token to flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn setFlowPermissionsWithCtx​

function setFlowPermissionsWithCtx(
    contract ISuperToken token,
    address flowOperator,
    bool allowCreate,
    bool allowUpdate,
    bool allowDelete,
    int96 flowRateAllowance,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Update permissions for flow operator in callback
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address given flow permissions
allowCreate	bool	creation permissions
allowUpdate	bool
allowDelete	bool
flowRateAllowance	int96	The allowance provided to flowOperator
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function

allowing userData to be a parameter here triggered stack too deep error
Fn setMaxFlowPermissionsWithCtx​

function setMaxFlowPermissionsWithCtx(
    contract ISuperToken token,
    address flowOperator,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Update permissions for flow operator - give operator max permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address given flow permissions
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn revokeFlowPermissionsWithCtx​

function revokeFlowPermissionsWithCtx(
    contract ISuperToken token,
    address flowOperator,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Update permissions for flow operator - revoke all permission
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
flowOperator	address	The address given flow permissions
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn getCFAFlowRate​

function getCFAFlowRate(
    contract ISuperToken token,
    address sender,
    address receiver
)
    internal
    returns (int96 flowRate)

get CFA flow rate between two accounts for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
Return Values​
Name	Type	Description
flowRate	int96	The flow rate
Fn getCFAFlowInfo​

function getCFAFlowInfo(
    contract ISuperToken token,
    address sender,
    address receiver
)
    internal
    returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit)

get CFA flow info between two accounts for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	The sender of the flow
receiver	address	The receiver of the flow
Return Values​
Name	Type	Description
lastUpdated	uint256	Timestamp of flow creation or last flowrate change
flowRate	int96	The flow rate
deposit	uint256	The amount of deposit the flow
owedDeposit	uint256	The amount of owed deposit of the flow
Fn getCFANetFlowRate​

function getCFANetFlowRate(
    contract ISuperToken token,
    address account
)
    internal
    returns (int96 flowRate)

get CFA net flow rate for given account for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
account	address	Account to query
Return Values​
Name	Type	Description
flowRate	int96	The net flow rate of the account
Fn getCFANetFlowInfo​

function getCFANetFlowInfo(
    contract ISuperToken token,
    address account
)
    internal
    returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit)

get the aggregated CFA flow info of the account
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
account	address	Account to query
Return Values​
Name	Type	Description
lastUpdated	uint256	Timestamp of the last change of the net flow
flowRate	int96	The net flow rate of token for account
deposit	uint256	The sum of all deposits for account's flows
owedDeposit	uint256	The sum of all owed deposits for account's flows
Fn getFlowPermissions​

function getFlowPermissions(
    contract ISuperToken token,
    address sender,
    address flowOperator
)
    internal
    returns (bool allowCreate, bool allowUpdate, bool allowDelete, int96 flowRateAllowance)

get existing CFA flow permissions
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
sender	address	sender of a flow
flowOperator	address	the address we are checking permissions of for sender & token
Return Values​
Name	Type	Description
allowCreate	bool	is true if the flowOperator can create flows
allowUpdate	bool	is true if the flowOperator can update flows
allowDelete	bool	is true if the flowOperator can delete flows
flowRateAllowance	int96	The flow rate allowance the flowOperator is granted (only goes down)
Fn createPool​

function createPool(
    contract ISuperToken token,
    address admin,
    struct PoolConfig poolConfig
)
    internal
    returns (contract ISuperfluidPool pool)

Creates a new Superfluid Pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
admin	address	The pool admin address.
poolConfig	struct PoolConfig	The pool configuration (see PoolConfig in IGeneralDistributionAgreementV1.sol)
Return Values​
Name	Type	Description
pool	contract ISuperfluidPool	The address of the deployed Superfluid Pool
Fn createPool​

function createPool(
    contract ISuperToken token,
    address admin
)
    internal
    returns (contract ISuperfluidPool pool)

Creates a new Superfluid Pool with default PoolConfig: units not transferrable, allow multi-distributors
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
admin	address	The pool admin address.
Return Values​
Name	Type	Description
pool	contract ISuperfluidPool	The address of the deployed Superfluid Pool
Fn createPool​

function createPool(
    contract ISuperToken token
)
    internal
    returns (contract ISuperfluidPool pool)

Creates a new Superfluid Pool with default PoolConfig and the caller set as admin
Parameters​
Name	Type	Description
token	contract ISuperToken
Return Values​
Name	Type	Description
pool	contract ISuperfluidPool	The address of the deployed Superfluid Pool
Fn claimAll​

function claimAll(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    address memberAddress
)
    internal
    returns (bool)

Claims all tokens from the pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to claim from.
memberAddress	address	The address of the member to claim for.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the claim was successful.
Fn claimAll (with User Data)​

function claimAll(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    address memberAddress,
    bytes userData
)
    internal
    returns (bool)

Claims all tokens from the pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to claim from.
memberAddress	address	The address of the member to claim for.
userData	bytes	User-specific data.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the claim was successful.
Fn connectPool​

function connectPool(
    contract ISuperToken token,
    contract ISuperfluidPool pool
)
    internal
    returns (bool)

Connects a pool member to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to connect.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the connection was successful.
Fn connectPool (with User Data)​

function connectPool(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    bytes userData
)
    internal
    returns (bool)

Connects a pool member to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to connect.
userData	bytes	User-specific data.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the connection was successful.
Fn disconnectPool​

function disconnectPool(
    contract ISuperToken token,
    contract ISuperfluidPool pool
)
    internal
    returns (bool)

Disconnects a pool member from pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to disconnect.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the disconnection was successful.
Fn disconnectPool (with User Data)​

function disconnectPool(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    bytes userData
)
    internal
    returns (bool)

Disconnects a pool member from pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to disconnect.
userData	bytes	User-specific data.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the disconnection was successful.
Fn distribute​

function distribute(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    uint256 requestedAmount
)
    internal
    returns (bool)

Tries to distribute requestedAmount amount of token from from to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool address.
requestedAmount	uint256	The amount of tokens to distribute.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the distribution was successful.
Fn distribute (with User Data)​

function distribute(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool pool,
    uint256 requestedAmount,
    bytes userData
)
    internal
    returns (bool)

Tries to distribute requestedAmount amount of token from from to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
from	address	The address from which to distribute tokens.
pool	contract ISuperfluidPool	The Superfluid Pool address.
requestedAmount	uint256	The amount of tokens to distribute.
userData	bytes	User-specific data.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the distribution was successful.
Fn distributeFlow​

function distributeFlow(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    int96 requestedFlowRate
)
    internal
    returns (bool)

Tries to distribute flow at requestedFlowRate of token from from to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool address.
requestedFlowRate	int96	The flow rate of tokens to distribute.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the distribution was successful.
Fn distributeFlow (with User Data)​

function distributeFlow(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool pool,
    int96 requestedFlowRate,
    bytes userData
)
    internal
    returns (bool)

Tries to distribute flow at requestedFlowRate of token from from to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
from	address	The address from which to distribute tokens.
pool	contract ISuperfluidPool	The Superfluid Pool address.
requestedFlowRate	int96	The flow rate of tokens to distribute.
userData	bytes	User-specific data.
Return Values​
Name	Type	Description
[0]	bool	A boolean value indicating whether the distribution was successful.
Fn claimAllWithCtx​

function claimAllWithCtx(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    address memberAddress,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Claims all tokens from the pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to claim from.
memberAddress	address	The address of the member to claim for.
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn connectPoolWithCtx​

function connectPoolWithCtx(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Connects a pool member to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to connect.
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn disconnectPoolWithCtx​

function disconnectPoolWithCtx(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Disconnects a pool member from pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
pool	contract ISuperfluidPool	The Superfluid Pool to disconnect.
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn distributeWithCtx​

function distributeWithCtx(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool pool,
    uint256 requestedAmount,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Tries to distribute requestedAmount amount of token from from to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
from	address	The address from which to distribute tokens.
pool	contract ISuperfluidPool	The Superfluid Pool address.
requestedAmount	uint256	The amount of tokens to distribute.
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn distributeFlowWithCtx​

function distributeFlowWithCtx(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool pool,
    int96 requestedFlowRate,
    bytes ctx
)
    internal
    returns (bytes newCtx)

Tries to distribute flow at requestedFlowRate of token from from to pool.
Parameters​
Name	Type	Description
token	contract ISuperToken	The Super Token address.
from	address	The address from which to distribute tokens.
pool	contract ISuperfluidPool	The Superfluid Pool address.
requestedFlowRate	int96	The flow rate of tokens to distribute.
ctx	bytes	Context bytes (see ISuperfluid.sol for Context struct)
Return Values​
Name	Type	Description
newCtx	bytes	The updated context after the execution of the agreement function
Fn getGDAFlowRate​

function getGDAFlowRate(
    contract ISuperToken token,
    address distributor,
    contract ISuperfluidPool pool
)
    internal
    returns (int96 flowRate)

get flowrate between a distributor and pool for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
distributor	address	The ditributor of the flow
pool	contract ISuperfluidPool	The GDA pool
Return Values​
Name	Type	Description
flowRate	int96	The flow rate
Fn getFlowDistributionFlowRate​

function getFlowDistributionFlowRate(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool to
)
    internal
    returns (int96)

Parameters​
Name	Type	Description
token	contract ISuperToken
from	address
to	contract ISuperfluidPool

alias of getGDAFlowRate
Fn getGDAFlowInfo​

function getGDAFlowInfo(
    contract ISuperToken token,
    address distributor,
    contract ISuperfluidPool pool
)
    internal
    returns (uint256 lastUpdated, int96 flowRate, uint256 deposit)

get flow info of a distributor to a pool for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	The token used in flow
distributor	address	The ditributor of the flow
pool	contract ISuperfluidPool	The GDA pool
Return Values​
Name	Type	Description
lastUpdated	uint256	Timestamp of flow creation or last flowrate change
flowRate	int96	The flow rate
deposit	uint256	The amount of deposit the flow
Fn getGDANetFlowRate​

function getGDANetFlowRate(
    contract ISuperToken token,
    address account
)
    internal
    returns (int96 flowRate)

get GDA net flow rate for given account for given token
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
account	address	Account to query
Return Values​
Name	Type	Description
flowRate	int96	The net flow rate of the account
Fn getGDANetFlowInfo​

function getGDANetFlowInfo(
    contract ISuperToken token,
    address account
)
    internal
    returns (uint256 lastUpdated, int96 flowRate, uint256 deposit, uint256 owedDeposit)

get the aggregated GDA flow info of the account
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
account	address	Account to query
Return Values​
Name	Type	Description
lastUpdated	uint256	Timestamp of the last change of the net flow
flowRate	int96	The net flow rate of token for account
deposit	uint256	The sum of all deposits for account's flows
owedDeposit	uint256	The sum of all owed deposits for account's flows
Fn getPoolAdjustmentFlowRate​

function getPoolAdjustmentFlowRate(
    contract ISuperToken token,
    contract ISuperfluidPool pool
)
    internal
    returns (int96 poolAdjustmentFlowRate)

get the adjustment flow rate for a pool
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
pool	contract ISuperfluidPool	The pool to query
Return Values​
Name	Type	Description
poolAdjustmentFlowRate	int96	The adjustment flow rate of the pool
Fn getTotalAmountReceivedByMember​

function getTotalAmountReceivedByMember(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    address memberAddr
)
    internal
    returns (uint256 totalAmountReceived)

Get the total amount of tokens received by a member via instant and flowing distributions
Parameters​
Name	Type	Description
token	contract ISuperToken	Super token address
pool	contract ISuperfluidPool	The pool to query
memberAddr	address	The member to query
Return Values​
Name	Type	Description
totalAmountReceived	uint256	The total amount received by the member
Fn getTotalAmountReceivedFromPool​

function getTotalAmountReceivedFromPool(
    contract ISuperToken token,
    contract ISuperfluidPool pool,
    address memberAddr
)
    internal
    returns (uint256 totalAmountReceived)

Parameters​
Name	Type	Description
token	contract ISuperToken
pool	contract ISuperfluidPool
memberAddr	address

alias for getTotalAmountReceivedByMember
Fn estimateFlowDistributionActualFlowRate​

function estimateFlowDistributionActualFlowRate(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool to,
    int96 requestedFlowRate
)
    internal
    returns (int96 actualFlowRate, int96 totalDistributionFlowRate)

Parameters​
Name	Type	Description
token	contract ISuperToken
from	address
to	contract ISuperfluidPool
requestedFlowRate	int96
Fn estimateDistributionActualAmount​

function estimateDistributionActualAmount(
    contract ISuperToken token,
    address from,
    contract ISuperfluidPool to,
    uint256 requestedAmount
)
    internal
    returns (uint256 actualAmount)

Parameters​
Name	Type	Description
token	contract ISuperToken
from	address
to	contract ISuperfluidPool
requestedAmount	uint256
Fn isMemberConnected​

function isMemberConnected(
    contract ISuperToken token,
    address pool,
    address member
)
    internal
    returns (bool)

Parameters​
Name	Type	Description
token	contract ISuperToken
pool	address
member	address
