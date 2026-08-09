package speechtext

import "testing"

// applyPhysics runs only the physics group. The package-level Normalize would
// drag in the other rule groups, whose behaviour is not what these tests are
// about, so the pipeline is deliberately bypassed here.
func applyPhysics(text string) string {
	for _, rule := range physicsRules() {
		text = rule.apply(text)
	}
	return text
}

// checkPhysics asserts the exact full output rather than merely that something
// changed. A rule that drops text still "fires", so a substring assertion would
// happily pass while content disappeared.
func checkPhysics(t *testing.T, cases []struct{ name, input, want string }) {
	t.Helper()
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := applyPhysics(testCase.input); got != testCase.want {
				t.Errorf("applyPhysics(%q)\n got: %q\nwant: %q", testCase.input, got, testCase.want)
			}
		})
	}
}

func TestPhysicsCompoundUnits(t *testing.T) {
	checkPhysics(t, []struct{ name, input, want string }{
		{"metres per second", "5 m/s", "5米每秒"},
		{"acceleration keeps its square", "g = 9.8 m/s²", "g = 9.8米每二次方秒"},
		{"ascii exponent", "9.8 m/s^2", "9.8米每二次方秒"},
		{"kilometres per hour", "120 km/h", "120千米每小时"},
		{"kilometres per second", "7.9 km/s", "7.9千米每秒"},
		{"density", "1000 kg/m³", "1000千克每立方米"},
		{"density in cgs", "2.7 g/cm³", "2.7克每立方厘米"},
		{"action", "6.63 J·s", "6.63焦耳秒"},
		{"torque", "10 N·m", "10牛顿米"},
		{"irradiance", "1361 W/m²", "1361瓦每平方米"},
		{"concentration", "0.1 mol/L", "0.1摩尔每升"},
		{"molar mass", "18 g/mol", "18克每摩尔"},
		{"angular velocity", "2 rad/s", "2弧度每秒"},
		{"spring constant", "100 N/m", "100牛每米"},
		{"specific heat", "4200 J/(kg·K)", "4200焦耳每千克开尔文"},
		{"field strength", "50 V/m", "50伏每米"},
		{"current density", "5 A/m²", "5安每平方米"},
		{"no number is still safe", "单位是 m/s", "单位是 米每秒"},
		{"leading k is not shed", "km/s", "千米每秒"},
		{"middle dot variant", "6.63 J⋅s", "6.63焦耳秒"},
	})
}

// TestPhysicsCompoundUnitsBeatSingleUnits pins the ordering. If the single-unit
// rules ever run first, "m/s²" is shredded into a metre, a slash and a squared
// second, which is the failure a benchmark caught as 「G等于每秒9.8米」.
func TestPhysicsCompoundUnitsBeatSingleUnits(t *testing.T) {
	const input = "a = 9.8 m/s², v = 3 m/s"
	const want = "a = 9.8米每二次方秒, v = 3米每秒"
	if got := applyPhysics(input); got != want {
		t.Errorf("applyPhysics(%q)\n got: %q\nwant: %q", input, got, want)
	}
}

func TestPhysicsTemperature(t *testing.T) {
	checkPhysics(t, []struct{ name, input, want string }{
		{"celsius with space", "25 °C", "25摄氏度"},
		{"celsius without space", "25°C", "25摄氏度"},
		{"precomposed celsius", "25℃", "25摄氏度"},
		{"fahrenheit", "98.6 °F", "98.6华氏度"},
		{"precomposed fahrenheit", "98.6℉", "98.6华氏度"},
		{"unicode minus", "−273.15 °C", "负273.15摄氏度"},
		{"ascii hyphen", "-273.15 °C", "负273.15摄氏度"},
		{"minus without decimals", "-40 °C", "负40摄氏度"},
		{"bare degree sign is unambiguous", "水在 °C 下测量", "水在 摄氏度 下测量"},
		{"kelvin needs a number", "300 K", "300开尔文"},
		{"kelvin in a sentence", "绝对零度是 0 K", "绝对零度是 0开尔文"},
		// A range is not a negative number; the hyphen must survive as itself.
		{"celsius range", "20-30 °C", "20-30摄氏度"},
	})
}

func TestPhysicsSingleUnits(t *testing.T) {
	checkPhysics(t, []struct{ name, input, want string }{
		{"metre", "3 m", "3米"},
		{"kilometre", "5 km", "5千米"},
		{"centimetre", "15 cm", "15厘米"},
		{"millimetre", "2 mm", "2毫米"},
		{"micrometre", "10 μm", "10微米"},
		{"ascii micrometre", "10 um", "10微米"},
		{"nanometre", "500 nm", "500纳米"},
		{"angstrom", "1 Å", "1埃"},
		{"square metre", "20 m²", "20平方米"},
		{"cubic metre", "2 m³", "2立方米"},
		{"second", "10 s", "10秒"},
		{"millisecond", "20 ms", "20毫秒"},
		{"microsecond", "5 μs", "5微秒"},
		{"nanosecond", "3 ns", "3纳秒"},
		{"minute", "30 min", "30分钟"},
		{"hour", "2 h", "2小时"},
		{"gram", "500 g", "500克"},
		{"kilogram", "70 kg", "70千克"},
		{"milligram", "250 mg", "250毫克"},
		{"tonne", "3 t", "3吨"},
		{"newton", "10 N", "10牛"},
		{"kilonewton", "4 kN", "4千牛"},
		{"joule", "100 J", "100焦耳"},
		{"kilojoule", "8 kJ", "8千焦"},
		{"megajoule", "3.6 MJ", "3.6兆焦"},
		{"watt", "60 W", "60瓦"},
		{"kilowatt", "1.5 kW", "1.5千瓦"},
		{"megawatt", "600 MW", "600兆瓦"},
		{"pascal", "500 Pa", "500帕"},
		{"kilopascal", "101 kPa", "101千帕"},
		{"megapascal", "20 MPa", "20兆帕"},
		{"hertz", "50 Hz", "50赫兹"},
		{"kilohertz", "44 kHz", "44千赫"},
		{"megahertz", "100 MHz", "100兆赫"},
		{"gigahertz", "2.4 GHz", "2.4吉赫"},
		{"volt", "220 V", "220伏"},
		{"millivolt", "5 mV", "5毫伏"},
		{"kilovolt", "10 kV", "10千伏"},
		{"ampere", "2 A", "2安"},
		{"milliampere", "200 mA", "200毫安"},
		{"microampere", "50 μA", "50微安"},
		{"ascii microampere", "50 uA", "50微安"},
		{"ohm", "50 Ω", "50欧姆"},
		{"kilohm", "4.7 kΩ", "4.7千欧"},
		{"megohm", "1 MΩ", "1兆欧"},
		{"farad", "1 F", "1法拉"},
		{"microfarad", "10 μF", "10微法"},
		{"ascii microfarad", "10 uF", "10微法"},
		{"picofarad", "100 pF", "100皮法"},
		{"nanofarad", "22 nF", "22纳法"},
		{"henry", "2 H", "2亨利"},
		{"millihenry", "10 mH", "10毫亨"},
		{"tesla", "1.5 T", "1.5特斯拉"},
		{"weber", "3 Wb", "3韦伯"},
		{"coulomb", "5 C", "5库仑"},
		{"mole", "2 mol", "2摩尔"},
		{"litre", "3 L", "3升"},
		{"millilitre", "500 mL", "500毫升"},
		{"candela", "100 cd", "100坎德拉"},
		{"lumen", "800 lm", "800流明"},
		{"lux", "300 lx", "300勒克斯"},
		{"becquerel", "100 Bq", "100贝克勒尔"},
		{"gray", "2 Gy", "2戈瑞"},
		{"sievert", "1 Sv", "1西弗"},
		{"electronvolt", "13.6 eV", "13.6电子伏"},
		{"kiloelectronvolt", "10 keV", "10千电子伏"},
		{"megaelectronvolt", "938 MeV", "938兆电子伏"},
		{"decibel", "60 dB", "60分贝"},
		{"radian", "3 rad", "3弧度"},
		{"byte", "512 B", "512字节"},
		{"kilobyte", "256 KB", "256千字节"},
		{"megabyte", "8 MB", "8兆字节"},
		{"gigabyte", "16 GB", "16吉字节"},
		{"terabyte", "2 TB", "2太字节"},
		{"no space needed", "220V", "220伏"},
		{"decimal value", "1.5 kg", "1.5千克"},
		{"thousands separator", "1,234 kW", "1,234千瓦"},
		{"negative value", "-5 °F", "负5华氏度"},
		{"negative with unicode minus", "−3 mV", "负3毫伏"},
		{"inside a sentence", "电压是 220 V, 电流是 2 A", "电压是 220伏, 电流是 2安"},
		// A subtraction and a range are not signed values.
		{"range keeps its hyphen", "3-5 m", "3-5米"},
	})
}

// TestPhysicsUnitsAreCaseSensitive guards the milli/mega distinction. A
// benchmark read "200 mA" as 「200米A」 and "3.6 MJ" as 「3.6mJ」, so the two
// prefixes must never be folded together by a stray (?i).
func TestPhysicsUnitsAreCaseSensitive(t *testing.T) {
	checkPhysics(t, []struct{ name, input, want string }{
		{"milliampere expands", "200 mA", "200毫安"},
		{"MA is not milliampere", "200 MA", "200 MA"},
		{"megajoule is not millijoule", "3.6 MJ", "3.6兆焦"},
		{"tonne and tesla differ", "3 t", "3吨"},
		{"tesla and tonne differ", "3 T", "3特斯拉"},
		{"hour and henry differ", "2 h", "2小时"},
		{"henry and hour differ", "2 H", "2亨利"},
		{"kilobyte is not kelvin followed by B", "256 KB", "256千字节"},
	})
}

// TestPhysicsLeavesBareSymbolsAlone is the important half of the suite. The
// conservative policy exists so that a variable is never promoted to a unit, and
// every case here would be a silent corruption of meaning if it failed.
func TestPhysicsLeavesBareSymbolsAlone(t *testing.T) {
	checkPhysics(t, []struct{ name, input, want string }{
		{"V is a voltage variable", "V = IR", "V = IR"},
		{"T is a transpose", "Aᵀ = A", "Aᵀ = A"},
		{"T is a period", "周期 T 与频率 f 互为倒数", "周期 T 与频率 f 互为倒数"},
		{"C is an arbitrary constant", "设 C 为常数", "设 C 为常数"},
		{"A is an English article", "A cat sat on a mat", "A cat sat on a mat"},
		{"m is a mass", "F = ma, 其中 m 是质量", "F = ma, 其中 m 是质量"},
		{"markdown table cell", "| m | 米 |", "| m | 米 |"},
		{"markdown table cell for volts", "| V | 伏 |", "| V | 伏 |"},
		{"no unit follows the number", "The answer is 42.", "The answer is 42."},
		{"apples are not amperes", "3 apples", "3 apples"},
		{"plural words are not units", "3 meters", "3 meters"},
		{"minutes spelled out", "30 minutes", "30 minutes"},
		{"unit glued to a longer word", "200 mAh", "200 mAh"},
		{"K is not a temperature here", "按 K 排序", "按 K 排序"},
		{"bare N is a variable", "N 个粒子", "N 个粒子"},
		{"plain prose is untouched", "这是一段普通的中文说明。", "这是一段普通的中文说明。"},
	})
}

func TestPhysicsConstants(t *testing.T) {
	checkPhysics(t, []struct{ name, input, want string }{
		{"h bar", "ħ = h/2π", "约化普朗克常数 = h/2π"},
		{"planck constant over two pi", "ℏω", "约化普朗克常数ω"},
		{"vacuum permittivity", "ε₀ 是真空介电常数", "真空介电常数 是真空介电常数"},
		{"vacuum permeability", "μ₀ = 4π×10⁻⁷", "真空磁导率 = 4π×10⁻⁷"},
		{"avogadro with underscore", "N_A ≈ 6.02×10²³", "阿伏伽德罗常数 ≈ 6.02×10²³"},
		{"avogadro with subscript", "Nₐ ≈ 6.02×10²³", "阿伏伽德罗常数 ≈ 6.02×10²³"},
		{"boltzmann uppercase", "k_B T", "玻尔兹曼常数 T"},
		{"boltzmann lowercase", "k_b T", "玻尔兹曼常数 T"},
		// The newton in the single-unit table must not bite off the N first.
		{"newton does not eat avogadro", "2 N_A", "2阿伏伽德罗常数"},
	})
}
