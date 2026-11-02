# Hunger & Thirst bars — source integration notes

The compiled HTML in this repo loads `hunger-thirst.js` (add this line right after the existing early `<script>` blocks in both HTML files if not already present):

```html
<script src="hunger-thirst.js"></script>
```

## For the full SugarCube source (gitgud.io/Frostberg/degrees-of-lewdity-plus)

Add these to the appropriate files, then recompile with `compile.bat` / `compile.sh`.

### variables-start.twee (or variables-versionUpdate.twee)
```
<<set $hunger to 0>>
<<set $hungermax to 2000>>
<<set $thirst to 0>>
<<set $thirstmax to 2000>>
```

### New widgets (e.g. in base-system/widgets.twee or a new file)
```
<<widget "hunger">>
	<<if _args[0]>>
		<<set $hunger += _args[0]>>
		<<set $hunger to Math.max(0, Math.min($hungermax, $hunger))>>
	<</if>>
<</widget>>

<<widget "thirst">>
	<<if _args[0]>>
		<<set $thirst += _args[0]>>
		<<set $thirst to Math.max(0, Math.min($thirstmax, $thirst))>>
	<</if>>
<</widget>>

<<widget "hungercaption">>
	<div id="hungercaption" @title="'Hunger: ' + $hunger">
		<div @class="($options.showCaptionText is true ? '' : 'rightMeterText')">
			Hunger:
			<<if $options.showCaptionText is true>>
				<<if $hunger gte $hungermax * 0.9>><span class="red">You are starving.</span>
				<<elseif $hunger gte $hungermax * 0.7>><span class="pink">You are very hungry.</span>
				<<elseif $hunger gte $hungermax * 0.4>><span class="pink">You are hungry.</span>
				<<elseif $hunger gte $hungermax * 0.15>><span class="blue">You are peckish.</span>
				<<else>><span class="blue">You are full.</span><</if>>
			<</if>>
		</div>
		<<statbar $hunger $hungermax>>
		<div style="clear:both;"></div>
	</div>
<</widget>>

<<widget "thirstcaption">>
	<div id="thirstcaption" @title="'Thirst: ' + $thirst">
		<div @class="($options.showCaptionText is true ? '' : 'rightMeterText')">
			Thirst:
			<<if $options.showCaptionText is true>>
				<<if $thirst gte $thirstmax * 0.9>><span class="red">You are dehydrated.</span>
				<<elseif $thirst gte $thirstmax * 0.7>><span class="pink">You are very thirsty.</span>
				<<elseif $thirst gte $thirstmax * 0.4>><span class="pink">You are thirsty.</span>
				<<elseif $thirst gte $thirstmax * 0.15>><span class="blue">You are a little dry.</span>
				<<else>><span class="blue">You are hydrated.</span><</if>>
			<</if>>
		</div>
		<<statbar $thirst $thirstmax>>
		<div style="clear:both;"></div>
	</div>
<</widget>>
```

### caption.twee — inside the `#statmeters` div
Add after the existing caption calls:
```
<<hungercaption>>
<<thirstcaption>>
```

### Time increase (inside the main effects / time passage widget)
```
<<hunger 4>>   /* roughly per minute of game time; adjust as needed */
<<thirst 5>>
```

Call `<<hunger -300>>` / `<<thirst -400>>` (or similar) from eating/drinking passages.
