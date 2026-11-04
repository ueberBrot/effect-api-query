# configureUtils performance measurements

Measured 2026-11-04 against base `604d8204e12861edc70d5996a873ff3d26919262`, package 0.5.0. Only `src/core/configure-utils.ts` differed between the matched source runs. The final workload script and locked dependencies were identical.

Command for each fresh process: `PERFORMANCE_OUTPUT=<report.json> vp run construction-baseline`. Three processes per implementation, 20 warmup iterations per workload, then five samples of 50 iterations. All three baseline processes preceded all three optimized processes. Both phases used the same Vite+/pnpm toolchain on Node 24.22.1, macOS arm64, Effect 4.0.6, and Query Core 5.104.5.

Both contracts have a records branch with 1, 250, or 1,000 payload-bearing buffered operations. Sparse configuration sets one leaf policy; dense configuration sets a policy on every leaf. Repeated configuration applies sparse settings, a shared root policy, then sparse settings to each successive result. Empty configuration passes an empty object. Contract and ready-client acquisition, initial factory construction, and configuration-object creation are outside configuration timings.

These are elapsed-time microbenchmarks on a shared machine, without CPU affinity, forced GC, or statistical significance tests. JIT, scheduling, and GC introduce noise. The observed improvements concern these configuration workloads; they do not establish application, query execution, factory, memory, or compiler speedups. Empty-workload timings are particularly close to timer and call overhead.

The table shows the median of 15 measured samples divided by 50, in milliseconds per workload iteration. A repeated iteration contains three configureUtils calls; all other iterations contain one.

| Adapter | Operations | Workload | Before ms/iteration | After ms/iteration |
| ------- | ---------: | -------- | ------------------: | -----------------: |
| RPC     |          1 | empty    |            0.006558 |           0.000505 |
| RPC     |          1 | sparse   |            0.007267 |           0.006085 |
| RPC     |          1 | dense    |            0.006156 |           0.004952 |
| RPC     |          1 | repeated |            0.019512 |           0.016358 |
| HTTP    |          1 | empty    |            0.004751 |           0.000286 |
| HTTP    |          1 | sparse   |            0.005515 |           0.005027 |
| HTTP    |          1 | dense    |            0.005574 |           0.003900 |
| HTTP    |          1 | repeated |            0.017134 |           0.011454 |
| RPC     |        250 | empty    |            0.723950 |           0.000072 |
| RPC     |        250 | sparse   |            0.658234 |           0.081734 |
| RPC     |        250 | dense    |            1.049528 |           0.847647 |
| RPC     |        250 | repeated |            2.483047 |           0.730341 |
| HTTP    |        250 | empty    |            0.734683 |           0.000083 |
| HTTP    |        250 | sparse   |            0.730028 |           0.087976 |
| HTTP    |        250 | dense    |            1.131675 |           0.876507 |
| HTTP    |        250 | repeated |            3.012389 |           0.790881 |
| RPC     |       1000 | empty    |            3.045939 |           0.000085 |
| RPC     |       1000 | sparse   |            3.001372 |           0.385091 |
| RPC     |       1000 | dense    |            7.563392 |           3.613185 |
| RPC     |       1000 | repeated |           12.395011 |           3.608434 |
| HTTP    |       1000 | empty    |            3.965372 |           0.000077 |
| HTTP    |       1000 | sparse   |            4.120216 |           0.416675 |
| HTTP    |       1000 | dense    |            8.523909 |           4.008217 |
| HTTP    |       1000 | repeated |           16.245678 |           3.923569 |

## Source fingerprints

- Workload SHA-256: `2fbad4879fe77ff24234a6be5666047b41cc7c3fd5ce9143d640ef4b41a426bd`
- Baseline configure-utils.ts SHA-256: `66201b1fd4b81f6b9a96e0dd9abee70329162d939bfbf1cbbec1415e65ac6f53`
- Optimized configure-utils.ts SHA-256: `31afe707e9ef3194f6b3a0ac888bb24583199a98e69ad1fcdaba4c76dea2ed60`

## Raw configuration samples

Each nested array is one process, containing its five elapsed millisecond samples for 50 iterations. These retain the outliers used in the table. The same script also reports factory and key/prepared-input workloads; those are outside the performance claim here.

```jsonl
{"adapter":"rpc","stage":"configure-empty","operations":1,"iterations":50,"beforeMilliseconds":[[0.7425,0.331917,0.318375,0.286833,0.266333],[0.347834,0.327875,0.283292,0.360125,0.262583],[0.36175,0.331625,0.408709,0.284916,0.269958]],"afterMilliseconds":[[0.04025,0.02775,0.022375,0.02225,0.0225],[0.035875,0.035084,0.0245,0.027,0.016333],[0.035375,0.029583,0.021625,0.02525,0.015458]]}
{"adapter":"rpc","stage":"configure-sparse","operations":1,"iterations":50,"beforeMilliseconds":[[0.38275,0.370833,0.652166,0.31375,0.292375],[0.372375,0.340208,0.332,0.292375,0.363375],[0.521334,0.334,0.408625,0.31875,0.491875]],"afterMilliseconds":[[0.389209,0.373584,0.289334,0.259125,0.265292],[0.381291,0.334167,0.329167,0.269125,0.247833],[0.30425,0.424166,0.270875,0.455166,0.288625]]}
{"adapter":"rpc","stage":"configure-dense","operations":1,"iterations":50,"beforeMilliseconds":[[0.26725,0.284833,0.343833,0.552084,0.367833],[0.399625,0.307791,0.294875,0.2695,0.2875],[0.39975,0.327042,0.342125,0.296916,0.284625]],"afterMilliseconds":[[0.220667,0.213875,0.188291,0.170958,0.254167],[0.247583,0.268916,0.233834,0.207667,0.266458],[0.36525,0.274916,0.275333,0.215,0.302875]]}
{"adapter":"rpc","stage":"configure-repeated","operations":1,"iterations":50,"beforeMilliseconds":[[3.781625,0.950792,0.858375,0.777208,0.773625],[1.036916,0.975584,0.905542,0.79175,0.779916],[2.523667,1.241334,1.277459,1.160333,1.066625]],"afterMilliseconds":[[0.862125,0.74125,9.077333,0.700958,0.716125],[0.977875,0.817917,0.820333,9.993958,0.683625],[0.854083,0.742875,0.754291,7.508708,0.693666]]}
{"adapter":"http","stage":"configure-empty","operations":1,"iterations":50,"beforeMilliseconds":[[0.237541,0.252792,0.232417,0.19975,0.202208],[0.255834,0.212291,0.21575,0.193334,0.225791],[0.298084,0.329417,0.270792,0.293709,0.268708]],"afterMilliseconds":[[0.006708,0.006708,0.015583,0.006834,0.008375],[0.014333,0.014292,0.041417,0.014208,0.015375],[0.014459,0.014417,0.04175,0.011916,0.012416]]}
{"adapter":"http","stage":"configure-sparse","operations":1,"iterations":50,"beforeMilliseconds":[[0.30075,0.238917,0.260833,0.238166,0.276292],[0.271417,0.274209,0.27575,0.26525,0.243417],[0.849875,1.016625,0.961584,0.391792,0.30975]],"afterMilliseconds":[[0.26875,0.2555,0.239708,0.213417,0.216375],[0.279625,0.251333,0.274292,0.225875,0.21225],[0.331875,0.275917,0.269792,0.229709,0.226625]]}
{"adapter":"http","stage":"configure-dense","operations":1,"iterations":50,"beforeMilliseconds":[[0.309125,0.245375,0.231625,0.211791,0.197917],[0.330667,0.278708,0.214834,0.241083,0.1915],[0.311292,0.332542,0.374708,0.514375,0.313709]],"afterMilliseconds":[[0.184583,0.287209,0.218792,0.192917,0.373041],[0.19,0.192166,0.21625,0.16325,0.154625],[0.194375,0.35275,0.321125,0.195,0.204]]}
{"adapter":"http","stage":"configure-repeated","operations":1,"iterations":50,"beforeMilliseconds":[[0.746125,0.856708,0.81975,0.803334,0.884208],[0.97075,0.863459,0.843875,0.809458,0.786208],[1.158333,1.476333,0.973792,0.933958,0.837041]],"afterMilliseconds":[[0.551042,0.620833,1.001166,0.829,0.516625],[0.52675,0.558416,0.567792,0.687709,0.637959],[0.544208,0.572709,0.61775,0.660916,0.520875]]}
{"adapter":"rpc","stage":"configure-empty","operations":250,"iterations":50,"beforeMilliseconds":[[45.511042,37.514666,31.656209,30.696167,31.579417],[47.165541,39.536916,31.978917,31.707,29.648709],[44.656125,40.138917,41.448542,36.1975,32.480292]],"afterMilliseconds":[[0.004292,0.003625,0.003542,0.003542,0.0035],[0.0045,0.003583,0.003666,0.0035,0.003542],[0.004167,0.00375,0.003583,0.003583,0.003709]]}
{"adapter":"rpc","stage":"configure-sparse","operations":250,"iterations":50,"beforeMilliseconds":[[34.708,31.548542,32.951917,30.31475,30.968042],[32.911708,31.469583,32.5,30.24825,32.222],[38.6375,41.494334,35.573625,65.013917,53.900042]],"afterMilliseconds":[[3.989833,4.086708,4.534,4.433625,4.145917],[4.501833,4.198625,5.354083,3.844584,3.84175],[4.005083,3.99875,3.787958,4.050375,4.248875]]}
{"adapter":"rpc","stage":"configure-dense","operations":250,"iterations":50,"beforeMilliseconds":[[49.522167,52.476417,49.290333,51.803792,50.685333],[50.01825,53.967458,48.525083,52.105416,53.368],[54.511666,54.06125,53.492083,57.27625,57.690625]],"afterMilliseconds":[[50.357583,48.125709,49.9385,42.382333,36.19525],[54.092792,41.531,38.871541,38.646208,37.555542],[54.830209,49.738125,42.826125,39.291208,36.234375]]}
{"adapter":"rpc","stage":"configure-repeated","operations":250,"iterations":50,"beforeMilliseconds":[[121.383583,117.882875,146.20125,118.686292,123.518333],[124.152333,126.018125,131.497542,122.970291,120.554875],[133.213083,127.751792,123.037958,127.168625,125.74025]],"afterMilliseconds":[[44.353542,36.517042,41.310875,35.041834,38.858625],[39.704292,37.936208,33.994083,34.535542,35.976417],[39.373416,35.643833,35.877917,38.748125,36.041416]]}
{"adapter":"http","stage":"configure-empty","operations":250,"iterations":50,"beforeMilliseconds":[[35.449625,32.863333,34.819875,35.809333,33.378708],[35.776583,40.671333,36.734167,41.927833,37.681542],[33.397416,43.548125,42.497417,41.508875,37.057709]],"afterMilliseconds":[[0.004458,0.004209,0.004209,0.004333,0.004209],[0.003958,0.003917,0.003917,0.004208,0.003917],[0.004167,0.004125,0.00425,0.004125,0.004167]]}
{"adapter":"http","stage":"configure-sparse","operations":250,"iterations":50,"beforeMilliseconds":[[33.378125,33.903834,33.782417,35.0175,33.577375],[36.501375,37.705416,40.140917,34.9795,35.335292],[39.613125,36.911709,37.41875,41.881417,37.992375]],"afterMilliseconds":[[4.92425,4.398792,3.699916,5.168416,4.475333],[4.171709,4.964959,4.394708,4.400542,4.065208],[3.76525,3.78975,4.61175,3.671166,4.537167]]}
{"adapter":"http","stage":"configure-dense","operations":250,"iterations":50,"beforeMilliseconds":[[54.475333,54.3625,51.826875,55.376209,58.1125],[56.242291,56.58375,57.490917,55.9885,57.109583],[54.518625,60.650917,60.171542,61.877833,62.166833]],"afterMilliseconds":[[46.372542,45.357792,43.825375,44.539209,40.821083],[42.485417,44.165917,42.3665,41.802,38.680458],[40.373375,41.259333,47.108791,44.507,44.114708]]}
{"adapter":"http","stage":"configure-repeated","operations":250,"iterations":50,"beforeMilliseconds":[[134.313375,129.425458,136.022417,142.221583,136.220917],[154.931125,148.764542,154.942167,150.619458,157.487917],[162.260083,152.596333,137.160416,172.34,150.67075]],"afterMilliseconds":[[39.731458,39.038125,39.544042,41.206167,36.180916],[37.45525,37.818834,38.007042,42.829958,41.061125],[40.841083,39.806834,41.870333,36.998292,36.316125]]}
{"adapter":"rpc","stage":"configure-empty","operations":1000,"iterations":50,"beforeMilliseconds":[[143.204083,145.282833,148.577292,139.03925,141.444833],[168.246208,159.173417,158.64075,200.602375,172.571333],[161.055417,164.891917,152.296958,139.648125,142.740042]],"afterMilliseconds":[[0.004917,0.0045,0.004958,0.004292,0.00425],[0.004417,0.003875,0.003708,0.003709,0.004583],[0.004583,0.00375,0.003709,0.003958,0.004167]]}
{"adapter":"rpc","stage":"configure-sparse","operations":1000,"iterations":50,"beforeMilliseconds":[[143.674208,141.57475,143.398208,150.068625,148.686],[157.416416,351.243917,284.267208,191.841541,178.771958],[146.787583,143.761167,142.686208,154.868417,161.74725]],"afterMilliseconds":[[24.2045,19.061125,18.810417,20.415709,20.372291],[25.44325,18.19325,18.818958,18.934916,20.257583],[21.017,19.097,22.176792,19.085458,19.254542]]}
{"adapter":"rpc","stage":"configure-dense","operations":1000,"iterations":50,"beforeMilliseconds":[[375.324375,378.169584,396.506375,365.856292,370.497875],[436.804959,382.089625,448.885416,382.619208,389.403083],[384.232541,358.874125,353.192167,357.997458,354.55725]],"afterMilliseconds":[[173.338708,184.117542,188.548583,177.661166,178.561917],[171.777208,167.869542,173.630417,180.65925,170.029625],[188.600958,188.79025,198.234958,182.438667,185.349208]]}
{"adapter":"rpc","stage":"configure-repeated","operations":1000,"iterations":50,"beforeMilliseconds":[[569.99125,575.107708,568.538666,558.647625,577.822],[779.204833,774.253375,698.5545,715.71,606.475417],[875.14225,665.142333,619.750542,629.20775,611.414167]],"afterMilliseconds":[[172.743083,249.721,272.79,252.019042,226.108583],[163.065083,170.67475,176.256834,174.972,171.648417],[180.421708,186.2775,189.247167,194.351791,180.363709]]}
{"adapter":"http","stage":"configure-empty","operations":1000,"iterations":50,"beforeMilliseconds":[[183.540333,210.938125,178.782375,172.82875,185.526458],[298.081417,250.462375,276.533208,192.590917,184.704416],[204.438084,196.631834,198.268583,341.020333,227.992666]],"afterMilliseconds":[[0.00425,0.004416,0.004209,0.004333,0.004209],[0.003917,0.003833,0.003833,0.003791,0.003792],[0.00375,0.00375,0.00375,0.00375,0.00375]]}
{"adapter":"http","stage":"configure-sparse","operations":1000,"iterations":50,"beforeMilliseconds":[[174.121708,179.644542,179.013292,186.287042,174.797833],[185.34075,198.817416,206.010792,224.504208,326.769292],[634.73075,381.286375,237.1495,315.382542,345.117458]],"afterMilliseconds":[[20.092375,24.814208,22.660709,26.966875,21.057917],[18.412375,22.953042,21.368667,20.83375,22.856084],[19.711833,18.811458,19.736667,19.504,18.591375]]}
{"adapter":"http","stage":"configure-dense","operations":1000,"iterations":50,"beforeMilliseconds":[[388.884958,390.889416,397.962459,436.038041,399.620917],[511.857125,383.407334,418.565959,448.371625,426.195458],[517.111625,409.637875,469.103792,546.685833,792.514]],"afterMilliseconds":[[388.005667,388.1185,306.765125,306.663042,266.494583],[192.850542,199.419083,195.088625,195.856917,194.426375],[214.495708,229.031041,199.10575,188.646667,200.410875]]}
{"adapter":"http","stage":"configure-repeated","operations":1000,"iterations":50,"beforeMilliseconds":[[714.69325,681.607708,682.151916,658.367208,677.735542],[932.441583,972.496125,812.283916,751.281084,764.298875],[1154.367292,1555.556958,1212.5455,1792.896334,1182.950167]],"afterMilliseconds":[[205.276916,218.38925,230.362875,233.465333,197.844542],[195.833625,191.939875,198.354625,183.6,185.801375],[195.788084,190.916459,196.178459,194.452542,201.563083]]}
```
